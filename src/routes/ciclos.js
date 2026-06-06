// src/routes/ciclos.js

'use strict';

const express = require('express');
const { query, transaction } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── HELPERS ───────────────────────────────────────────────────

function computeStats(vacas) {
  const total      = vacas.length;
  const pct        = n => total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
  const descartadas= vacas.filter(v => v.descarte).length;
  const muerte     = vacas.filter(v => v.descarte && v.descarte_estado === 'muerte').length;
  const feedlot    = vacas.filter(v => v.descarte && v.descarte_estado === 'feedlot').length;
  const preniadas  = vacas.filter(v => v.entore_estado === 'preniada').length;
  const vacias     = vacas.filter(v => v.entore_estado === 'vacia').length;
  const parieron   = vacas.filter(v => v.parto_estado  === 'pario').length;
  const destetaron = vacas.filter(v => v.destete_estado === 'desteto').length;
  return {
    total, descartadas, muerte, feedlot, preniadas, vacias, parieron, destetaron,
    pctDescarte: pct(descartadas), pctMuerte: pct(muerte), pctFeedlot: pct(feedlot),
    pctPrenez:   pct(preniadas),   pctVacias: pct(vacias),
    pctParto:    pct(parieron),    pctDestete: pct(destetaron),
  };
}

// ── CICLOS ────────────────────────────────────────────────────

// GET /api/ciclos?grupoId=xxx — listar ciclos con conteo de vacas
router.get('/', async (req, res) => {
  try {
    const { grupoId } = req.query;
    const tid = req.user.tenantId;

    // Query ciclos con conteo de vacas en una sola query via subquery
    let sql = `
      SELECT c.*,
        (SELECT COUNT(*) FROM vacas v WHERE v.ciclo_id = c.id AND v.tenant_id = c.tenant_id) AS vaca_count
      FROM ciclos c
      WHERE c.tenant_id = $1`;
    const params = [tid];
    if (grupoId) { sql += ' AND c.grupo_id = $2'; params.push(grupoId); }
    sql += ' ORDER BY c.fecha_inicio';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener ciclos.' });
  }
});

// GET /api/ciclos/:id — obtener ciclo con sus vacas
router.get('/:id', async (req, res) => {
  try {
    const cicloRes = await query(
      'SELECT * FROM ciclos WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId]
    );
    if (cicloRes.rowCount === 0) return res.status(404).json({ error: 'Ciclo no encontrado.' });

    const vacasRes = await query(
      'SELECT * FROM vacas WHERE ciclo_id = $1 AND tenant_id = $2 ORDER BY caravana',
      [req.params.id, req.user.tenantId]
    );

    const ciclo = cicloRes.rows[0];
    ciclo.vacas = vacasRes.rows;
    ciclo.stats = computeStats(vacasRes.rows);

    res.json(ciclo);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener ciclo.' });
  }
});

// POST /api/ciclos — crear ciclo
router.post('/', async (req, res) => {
  try {
    const { grupoId, nombre, fechaInicio } = req.body;
    if (!grupoId || !nombre?.trim() || !fechaInicio) {
      return res.status(400).json({ error: 'grupoId, nombre y fechaInicio requeridos.' });
    }

    // Verificar que el grupo pertenece al tenant
    const grpRes = await query(
      'SELECT id FROM grupos WHERE id = $1 AND tenant_id = $2',
      [grupoId, req.user.tenantId]
    );
    if (grpRes.rowCount === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });

    const result = await query(
      `INSERT INTO ciclos (tenant_id, grupo_id, nombre, fecha_inicio)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.tenantId, grupoId, nombre.trim(), fechaInicio]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear ciclo.' });
  }
});

// PUT /api/ciclos/:id — editar nombre/fecha/lote/obs
router.put('/:id', async (req, res) => {
  try {
    const { nombre, fechaInicio, lote, obs } = req.body;
    const result = await query(
      `UPDATE ciclos
       SET nombre = COALESCE($1, nombre),
           fecha_inicio = COALESCE($2, fecha_inicio),
           lote = COALESCE($3, lote),
           obs  = COALESCE($4, obs)
       WHERE id = $5 AND tenant_id = $6
       RETURNING *`,
      [nombre?.trim() || null, fechaInicio || null, lote ?? null, obs ?? null,
       req.params.id, req.user.tenantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Ciclo no encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al editar ciclo.' });
  }
});

// DELETE /api/ciclos/:id — eliminar ciclo
router.delete('/:id', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM ciclos WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Ciclo no encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar ciclo.' });
  }
});

// POST /api/ciclos/:id/finalizar — cerrar ciclo y guardar historial
router.post('/:id/finalizar', async (req, res) => {
  try {
    const tid = req.user.tenantId;

    const cicloRes = await query(
      'SELECT c.*, g.nombre AS grupo_nombre, e.nombre AS estancia_nombre FROM ciclos c JOIN grupos g ON c.grupo_id = g.id JOIN estancias e ON g.estancia_id = e.id WHERE c.id = $1 AND c.tenant_id = $2',
      [req.params.id, tid]
    );
    if (cicloRes.rowCount === 0) return res.status(404).json({ error: 'Ciclo no encontrado.' });
    const ciclo = cicloRes.rows[0];

    const vacasRes = await query(
      'SELECT * FROM vacas WHERE ciclo_id = $1 AND tenant_id = $2 ORDER BY caravana',
      [req.params.id, tid]
    );
    const vacas = vacasRes.rows;

    // Validar que no haya pendientes
    const problemas = [];
    vacas.forEach(v => {
      if (v.entore_estado === 'pendiente') {
        problemas.push(v.caravana + ' (entore pendiente)');
      } else if (v.descarte && v.descarte_estado === 'pendiente') {
        problemas.push(v.caravana + ' (descarte sin definir)');
      } else if (!v.descarte && v.entore_estado === 'preniada') {
        if (v.parto_estado === 'pendiente') {
          problemas.push(v.caravana + ' (parto pendiente)');
        } else if (v.parto_estado === 'pario' && (v.destete_estado === 'pendiente' || v.destete_estado === 'en_curso')) {
          problemas.push(v.caravana + ' (destete ' + v.destete_estado + ')');
        }
      }
    });
    if (problemas.length > 0) {
      const lista = problemas.slice(0, 5).join(', ') + (problemas.length > 5 ? '... y más' : '');
      return res.status(400).json({
        error: `No se puede finalizar: ${problemas.length} animal(es) con datos incompletos: ${lista}`
      });
    }

    const stats = computeStats(vacas);
    const fechaCierre = new Date().toISOString().slice(0, 10);

    await transaction(async (client) => {
      // Cerrar ciclo
      await client.query(
        'UPDATE ciclos SET estado = $1, fecha_cierre = $2 WHERE id = $3',
        ['cerrado', fechaCierre, req.params.id]
      );
      // Guardar historial
      await client.query(
        `INSERT INTO historial
           (tenant_id, ciclo_id, ciclo_nombre, grupo_id, grupo_nombre, estancia_nombre,
            fecha_inicio, fecha_cierre, obs, stats, vacas_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          tid, req.params.id, ciclo.nombre,
          ciclo.grupo_id, ciclo.grupo_nombre, ciclo.estancia_nombre,
          ciclo.fecha_inicio, fechaCierre, ciclo.obs,
          JSON.stringify(stats), JSON.stringify(vacas)
        ]
      );
    });

    res.json({ ok: true, fechaCierre, stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al finalizar ciclo.' });
  }
});

// POST /api/ciclos/:id/traspasar — traspasar vacas a otro ciclo
router.post('/:id/traspasar', async (req, res) => {
  try {
    const { aCicloId, caravanas } = req.body;  // caravanas=null → todas las no descartadas
    const tid = req.user.tenantId;

    // Verificar ciclo destino
    const destRes = await query(
      'SELECT id, grupo_id FROM ciclos WHERE id = $1 AND tenant_id = $2 AND estado != $3',
      [aCicloId, tid, 'cerrado']
    );
    if (destRes.rowCount === 0) return res.status(404).json({ error: 'Ciclo destino no encontrado.' });

    // Obtener vacas a traspasar
    let sql = 'SELECT * FROM vacas WHERE ciclo_id = $1 AND tenant_id = $2';
    const params = [req.params.id, tid];
    if (!caravanas) {
      sql += ' AND descarte = FALSE';  // todas las no descartadas
    } else {
      sql += ` AND caravana = ANY($3)`;
      params.push(caravanas);
    }
    const vacasRes = await query(sql, params);

    if (vacasRes.rowCount === 0) {
      return res.status(400).json({ error: 'No hay vacas para traspasar.' });
    }

    const destGrupoId = destRes.rows[0].grupo_id;
    let traspasadas = 0;

    await transaction(async (client) => {
      for (const v of vacasRes.rows) {
        // Verificar que no existe ya en el ciclo destino
        const dup = await client.query(
          'SELECT id FROM vacas WHERE ciclo_id = $1 AND caravana = $2',
          [aCicloId, v.caravana]
        );
        if (dup.rowCount > 0) continue;  // skip duplicada

        // Insertar en ciclo destino con datos en cero
        const newVaca = await client.query(
          `INSERT INTO vacas
             (tenant_id, ciclo_id, caravana, grupo_origen_id, grupo_actual_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [tid, aCicloId, v.caravana, v.grupo_actual_id, destGrupoId]
        );

        // Registrar movimiento
        await client.query(
          `INSERT INTO movimientos
             (tenant_id, vaca_id, de_ciclo_id, a_ciclo_id, de_grupo_id, a_grupo_id, tipo)
           VALUES ($1,$2,$3,$4,$5,$6,'traspasar')`,
          [tid, newVaca.rows[0].id, req.params.id, aCicloId, v.grupo_actual_id, destGrupoId]
        );

        traspasadas++;
      }
    });

    res.json({ ok: true, count: traspasadas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al traspasar vacas.' });
  }
});

module.exports = router;
