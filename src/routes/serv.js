'use strict';
const express = require('express');
const router  = express.Router();
const { query } = require('../db/pool');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

router.use(authMiddleware);

const tid = req => req.user.tenantId;

// ── ESTABLECIMIENTOS ─────────────────────────────────

router.get('/establecimientos', async (req, res) => {
  try {
    const result = await query(
      `SELECT e.*, COUNT(l.id) AS lotes_count
       FROM serv_establecimientos e
       LEFT JOIN serv_lotes l ON l.establecimiento_id = e.id
       WHERE e.tenant_id = $1
       GROUP BY e.id ORDER BY e.nombre`,
      [tid(req)]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener establecimientos.' });
  }
});

router.post('/establecimientos', requireAdmin, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });
    const result = await query(
      `INSERT INTO serv_establecimientos (tenant_id, nombre)
       VALUES ($1,$2) RETURNING *`,
      [tid(req), nombre.trim()]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear.' });
  }
});

router.put('/establecimientos/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre } = req.body;
    const result = await query(
      `UPDATE serv_establecimientos SET nombre=$1
       WHERE id=$2 AND tenant_id=$3 RETURNING *`,
      [nombre.trim(), req.params.id, tid(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar.' });
  }
});

router.delete('/establecimientos/:id', requireAdmin, async (req, res) => {
  try {
    await query(
      `DELETE FROM serv_establecimientos WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar.' });
  }
});

// ── LOTES ────────────────────────────────────────────

router.get('/establecimientos/:estId/lotes', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM serv_lotes
       WHERE establecimiento_id=$1 AND tenant_id=$2
       ORDER BY orden ASC, nombre`,
      [req.params.estId, tid(req)]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener lotes.' });
  }
});

router.post('/establecimientos/:estId/lotes', requireAdmin, async (req, res) => {
  try {
    const { nombre, hectareas } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });
    const result = await query(
      `INSERT INTO serv_lotes (tenant_id, establecimiento_id, nombre, hectareas)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [tid(req), req.params.estId, nombre.trim(), hectareas || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear lote.' });
  }
});

router.put('/lotes/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre, hectareas } = req.body;
    const result = await query(
      `UPDATE serv_lotes SET
         nombre=COALESCE($1,nombre),
         hectareas=COALESCE($2,hectareas)
       WHERE id=$3 AND tenant_id=$4 RETURNING *`,
      [nombre || null, hectareas ?? null, req.params.id, tid(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar lote.' });
  }
});

router.delete('/lotes/:id', requireAdmin, async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    await client.query('BEGIN');
    const loteId = req.params.id;
    const tId    = tid(req);

    const ciclos = await client.query(
      `SELECT id FROM serv_ciclos WHERE lote_id=$1 AND tenant_id=$2`,
      [loteId, tId]
    );
    const cicloIds = ciclos.rows.map(c => c.id);

    if (cicloIds.length > 0) {
      await client.query(
        `DELETE FROM serv_registros
         WHERE ciclo_id = ANY($1) AND tenant_id=$2`,
        [cicloIds, tId]
      );
      await client.query(
        `DELETE FROM serv_ciclos WHERE lote_id=$1 AND tenant_id=$2`,
        [loteId, tId]
      );
    }

    await client.query(
      `DELETE FROM serv_lotes WHERE id=$1 AND tenant_id=$2`,
      [loteId, tId]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error eliminando lote serv:', err);
    res.status(500).json({ error: 'Error al eliminar lote.' });
  } finally {
    client.release();
  }
});

router.put('/establecimientos/:estId/lotes/orden', requireAdmin, async (req, res) => {
  try {
    const { orden } = req.body;
    if (!Array.isArray(orden)) return res.status(400).json({ error: 'orden requerido.' });
    for (const item of orden) {
      await query(
        `UPDATE serv_lotes SET orden=$1 WHERE id=$2 AND tenant_id=$3`,
        [item.orden, item.id, tid(req)]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al reordenar.' });
  }
});

// ── CICLOS ───────────────────────────────────────────

router.get('/lotes/:loteId/ciclos', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM serv_ciclos
       WHERE lote_id=$1 AND tenant_id=$2
       ORDER BY creado_en DESC`,
      [req.params.loteId, tid(req)]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener ciclos.' });
  }
});

router.post('/lotes/:loteId/ciclos', async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });

    // Máximo 2 activos por lote — cerrar el más viejo si hay 2
    const activos = await query(
      `SELECT id, creado_en FROM serv_ciclos
       WHERE lote_id=$1 AND tenant_id=$2 AND estado='activo'
       ORDER BY creado_en ASC`,
      [req.params.loteId, tid(req)]
    );
    if (activos.rowCount >= 2) {
      await query(
        `UPDATE serv_ciclos SET estado='cerrado', fecha_cierre=CURRENT_DATE
         WHERE id=$1`,
        [activos.rows[0].id]
      );
    }

    const result = await query(
      `INSERT INTO serv_ciclos (tenant_id, lote_id, nombre, fecha_inicio)
       VALUES ($1,$2,$3,CURRENT_DATE) RETURNING *`,
      [tid(req), req.params.loteId, nombre.trim()]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear ciclo.' });
  }
});

router.put('/ciclos/:id', async (req, res) => {
  try {
    const { nombre, obs } = req.body;
    const result = await query(
      `UPDATE serv_ciclos SET
         nombre=COALESCE($1,nombre),
         obs=COALESCE($2,obs)
       WHERE id=$3 AND tenant_id=$4 RETURNING *`,
      [nombre || null, obs ?? null, req.params.id, tid(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar ciclo.' });
  }
});

router.delete('/ciclos/:id', async (req, res) => {
  try {
    await query(
      `DELETE FROM serv_ciclos WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar ciclo.' });
  }
});

// ── REGISTROS (siembra / cosecha) ────────────────────

router.get('/ciclos/:cicloId/registros', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM serv_registros
       WHERE ciclo_id=$1 AND tenant_id=$2
       ORDER BY fecha ASC`,
      [req.params.cicloId, tid(req)]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener registros.' });
  }
});

router.post('/ciclos/:cicloId/registros', async (req, res) => {
  try {
    const { tipo, fecha, hectareas, cultivo, tipo_cult,
            variedad, kilos, destino, obs } = req.body;

    if (!['siembra','cosecha'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo inválido. Solo siembra o cosecha.' });
    }
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida.' });

    // Si es siembra: fijar cultivo/tipo en el ciclo
    if (tipo === 'siembra') {
      const ciclo = await query(
        `SELECT cultivo, tipo FROM serv_ciclos WHERE id=$1`,
        [req.params.cicloId]
      );
      const c = ciclo.rows[0];
      if (c.cultivo && c.cultivo !== cultivo) {
        return res.status(400).json({
          error: `Este ciclo ya tiene cultivo "${c.cultivo}".`
        });
      }
      if (!c.cultivo) {
        await query(
          `UPDATE serv_ciclos SET cultivo=$1, tipo=$2, variedad=$3 WHERE id=$4`,
          [cultivo || null, tipo_cult || null, variedad || null, req.params.cicloId]
        );
      }
    }

    // Validar hectáreas vs lote
    const loteInfo = await query(
      `SELECT l.hectareas FROM serv_lotes l
       JOIN serv_ciclos c ON c.lote_id = l.id
       WHERE c.id=$1`,
      [req.params.cicloId]
    );
    const maxHa = parseFloat(loteInfo.rows[0]?.hectareas || 0);
    if (maxHa > 0 && hectareas && tipo === 'siembra') {
      const yaReg = await query(
        `SELECT COALESCE(SUM(hectareas),0) AS total
         FROM serv_registros
         WHERE ciclo_id=$1 AND tipo='siembra'`,
        [req.params.cicloId]
      );
      const totalHa = parseFloat(yaReg.rows[0].total) + parseFloat(hectareas);
      if (totalHa > maxHa) {
        return res.status(400).json({
          error: `Las hectáreas de siembra (${totalHa} ha) superan las del lote (${maxHa} ha).`
        });
      }
    }

    const result = await query(
      `INSERT INTO serv_registros
         (tenant_id, ciclo_id, tipo, fecha, hectareas,
          cultivo, tipo_cult, variedad, kilos, destino, obs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [tid(req), req.params.cicloId, tipo,
       fecha, hectareas || null,
       cultivo || null, tipo_cult || null, variedad || null,
       kilos || null, destino || null, obs || '']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar registro.' });
  }
});

router.put('/registros/:id', async (req, res) => {
  try {
    const { fecha, hectareas, kilos, destino, obs } = req.body;
    const result = await query(
      `UPDATE serv_registros SET
         fecha     = COALESCE($1,fecha),
         hectareas = COALESCE($2,hectareas),
         kilos     = COALESCE($3,kilos),
         destino   = COALESCE($4,destino),
         obs       = COALESCE($5,obs)
       WHERE id=$6 AND tenant_id=$7 RETURNING *`,
      [fecha || null, hectareas ?? null, kilos ?? null,
       destino || null, obs || null,
       req.params.id, tid(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar.' });
  }
});

router.delete('/registros/:id', async (req, res) => {
  try {
    await query(
      `DELETE FROM serv_registros WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar.' });
  }
});

module.exports = router;
