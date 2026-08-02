'use strict';

const express = require('express');
const router  = express.Router();
const { query } = require('../db/pool');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

router.use(authMiddleware);

const tid = req => req.user.tenantId;

// ── HELPERS ──────────────────────────────────────────────

async function calcToneladasSilo(siloId, tenantId) {
  const entradas = await query(
    `SELECT COALESCE(SUM(toneladas),0) AS total
     FROM agro_cosechas
     WHERE destino_silo_id=$1 AND tenant_id=$2`,
    [siloId, tenantId]
  );
  const salidas = await query(
    `SELECT COALESCE(SUM(toneladas),0) AS total
     FROM agro_movimientos_camion
     WHERE origen_silo_id=$1 AND tenant_id=$2`,
    [siloId, tenantId]
  );
  return parseFloat(entradas.rows[0].total) - parseFloat(salidas.rows[0].total);
}

async function calcToneladasBolsa(bolsaId, tenantId) {
  const entradas = await query(
    `SELECT COALESCE(SUM(toneladas),0) AS total
     FROM agro_cosechas
     WHERE destino_bolsa_id=$1 AND tenant_id=$2`,
    [bolsaId, tenantId]
  );
  const salidas = await query(
    `SELECT COALESCE(SUM(toneladas),0) AS total
     FROM agro_movimientos_camion
     WHERE origen_bolsa_id=$1 AND tenant_id=$2`,
    [bolsaId, tenantId]
  );
  return parseFloat(entradas.rows[0].total) - parseFloat(salidas.rows[0].total);
}

// ── ESTABLECIMIENTOS ─────────────────────────────────────

router.get('/establecimientos', async (req, res) => {
  try {
    const result = await query(
      `SELECT e.*, COUNT(l.id) AS lotes_count
       FROM agro_establecimientos e
       LEFT JOIN agro_lotes l ON l.establecimiento_id = e.id
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
      `INSERT INTO agro_establecimientos (tenant_id, nombre)
       VALUES ($1,$2) RETURNING *`,
      [tid(req), nombre.trim()]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear establecimiento.' });
  }
});

router.put('/establecimientos/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre } = req.body;
    const result = await query(
      `UPDATE agro_establecimientos SET nombre=$1
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
      `DELETE FROM agro_establecimientos WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar.' });
  }
});

// ── LOTES ────────────────────────────────────────────────

router.get('/establecimientos/:estId/lotes', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM agro_lotes
       WHERE establecimiento_id=$1 AND tenant_id=$2
       ORDER BY nombre`,
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
      `INSERT INTO agro_lotes (tenant_id, establecimiento_id, nombre, hectareas)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [tid(req), req.params.estId, nombre.trim(), hectareas || 0]
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
      `UPDATE agro_lotes SET nombre=COALESCE($1,nombre),
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
  try {
    await query(
      `DELETE FROM agro_lotes WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar lote.' });
  }
});

// ── CICLOS ───────────────────────────────────────────────

router.get('/lotes/:loteId/ciclos', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM agro_ciclos
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

    const activos = await query(
      `SELECT id, creado_en FROM agro_ciclos
       WHERE lote_id=$1 AND tenant_id=$2 AND estado='activo'
       ORDER BY creado_en ASC`,
      [req.params.loteId, tid(req)]
    );

    if (activos.rowCount >= 2) {
      await query(
        `UPDATE agro_ciclos SET estado='cerrado', fecha_cierre=CURRENT_DATE
         WHERE id=$1`,
        [activos.rows[0].id]
      );
    }

    const result = await query(
      `INSERT INTO agro_ciclos (tenant_id, lote_id, nombre, fecha_inicio)
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
      `UPDATE agro_ciclos
         SET nombre=COALESCE($1,nombre),
             obs=COALESCE($2,obs)
       WHERE id=$3 AND tenant_id=$4 RETURNING *`,
      [nombre || null, obs != null ? obs : null, req.params.id, tid(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar ciclo.' });
  }
});

router.delete('/ciclos/:id', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM agro_ciclos WHERE id=$1 AND tenant_id=$2 RETURNING id`,
      [req.params.id, tid(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar ciclo.' });
  }
});

// ── REGISTROS (siembra / fertilización / pulverización) ──

router.get('/ciclos/:cicloId/registros', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM agro_registros
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
    const { tipo, fecha, hectareas, cultivo, variedad,
            toneladas, producto, cantidad_kg, obs } = req.body;

    if (!['siembra', 'fertilizacion', 'pulverizacion'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo inválido.' });
    }

    if (tipo === 'siembra') {
      const ciclo = await query(
        `SELECT cultivo, variedad, tipo FROM agro_ciclos WHERE id=$1`,
        [req.params.cicloId]
      );
      const c = ciclo.rows[0];
      if (c.cultivo && c.cultivo !== cultivo) {
        return res.status(400).json({
          error: `Este ciclo ya tiene cultivo "${c.cultivo}". No podés mezclar cultivos.`
        });
      }
      // variedad aquí es el "Tipo" (Primera/Segunda) enviado desde el frontend
      if (c.tipo && variedad && c.tipo !== variedad) {
        return res.status(400).json({
          error: `Este ciclo ya tiene tipo "${c.tipo}". No podés mezclar tipos.`
        });
      }
      if (!c.cultivo) {
        await query(
          `UPDATE agro_ciclos SET cultivo=$1, tipo=$2, variedad=$3 WHERE id=$4`,
          [cultivo, variedad || null, obs || null, req.params.cicloId]
        );
      }
    }

    const result = await query(
      `INSERT INTO agro_registros
         (tenant_id, ciclo_id, tipo, fecha, hectareas,
          cultivo, variedad, toneladas, producto, cantidad_kg, obs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [tid(req), req.params.cicloId, tipo,
       fecha, hectareas || null,
       cultivo || null, variedad || null, toneladas || null,
       producto || null, cantidad_kg || null, obs || '']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar registro.' });
  }
});

router.put('/registros/:id', async (req, res) => {
  try {
    const { fecha, hectareas, cultivo, tipo, variedad,
            kilos, producto, cantidad_kg, obs } = req.body;
    const result = await query(
      `UPDATE agro_registros SET
         fecha       = COALESCE($1, fecha),
         hectareas   = COALESCE($2, hectareas),
         cultivo     = COALESCE($3, cultivo),
         tipo        = COALESCE($4, tipo),
         variedad    = COALESCE($5, variedad),
         toneladas   = COALESCE($6, toneladas),
         producto    = COALESCE($7, producto),
         cantidad_kg = COALESCE($8, cantidad_kg),
         obs         = COALESCE($9, obs)
       WHERE id=$10 AND tenant_id=$11 RETURNING *`,
      [fecha||null, hectareas??null, cultivo||null,
       tipo||null, variedad||null, kilos??null,
       producto||null, cantidad_kg??null, obs||null,
       req.params.id, tid(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar registro.' });
  }
});

router.delete('/registros/:id', requireAdmin, async (req, res) => {
  try {
    await query(
      `DELETE FROM agro_registros WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar registro.' });
  }
});

// ── COSECHAS ─────────────────────────────────────────────

router.get('/ciclos/:cicloId/cosechas', async (req, res) => {
  try {
    const result = await query(
      `SELECT c.*,
         s.nombre   AS silo_nombre,
         b.nombre   AS bolsa_nombre,
         cam.nombre AS camion_nombre,
         ext.nombre AS entidad_nombre
       FROM agro_cosechas c
       LEFT JOIN agro_silos s              ON s.id = c.destino_silo_id
       LEFT JOIN agro_bolsas b             ON b.id = c.destino_bolsa_id
       LEFT JOIN agro_camiones cam         ON cam.id = c.destino_camion_id
       LEFT JOIN agro_entidades_externas ext ON ext.id = c.entidad_externa_id
       WHERE c.ciclo_id=$1 AND c.tenant_id=$2
       ORDER BY c.fecha ASC`,
      [req.params.cicloId, tid(req)]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener cosechas.' });
  }
});

router.post('/ciclos/:cicloId/cosechas', async (req, res) => {
  try {
    const { fecha, hectareas, toneladas, destino_tipo,
            destino_silo_id, destino_bolsa_id,
            destino_camion_id, entidad_externa_id, obs } = req.body;

    if (!['silo', 'bolsa', 'camion'].includes(destino_tipo)) {
      return res.status(400).json({ error: 'Destino inválido.' });
    }

    if (destino_tipo === 'silo' && destino_silo_id) {
      const silo = await query(
        `SELECT cultivo_actual FROM agro_silos WHERE id=$1`,
        [destino_silo_id]
      );
      const ciclo = await query(
        `SELECT cultivo FROM agro_ciclos WHERE id=$1`,
        [req.params.cicloId]
      );
      const siloCultivo  = silo.rows[0]?.cultivo_actual;
      const cicloCultivo = ciclo.rows[0]?.cultivo;
      if (siloCultivo && cicloCultivo && siloCultivo !== cicloCultivo) {
        return res.status(400).json({
          error: `El silo ya tiene "${siloCultivo}". No podés mezclar cultivos.`
        });
      }
      if (!siloCultivo && cicloCultivo) {
        await query(
          `UPDATE agro_silos SET cultivo_actual=$1 WHERE id=$2`,
          [cicloCultivo, destino_silo_id]
        );
      }
    }

    const result = await query(
      `INSERT INTO agro_cosechas
         (tenant_id, ciclo_id, fecha, hectareas, toneladas,
          destino_tipo, destino_silo_id, destino_bolsa_id,
          destino_camion_id, entidad_externa_id, obs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [tid(req), req.params.cicloId, fecha,
       hectareas || null, toneladas,
       destino_tipo, destino_silo_id || null,
       destino_bolsa_id || null, destino_camion_id || null,
       entidad_externa_id || null, obs || '']
    );

    if (destino_tipo === 'bolsa' && destino_bolsa_id) {
      await query(
        `UPDATE agro_bolsas
         SET toneladas_totales = toneladas_totales + $1
         WHERE id=$2`,
        [toneladas, destino_bolsa_id]
      );
    }

    if (destino_tipo === 'camion' && destino_camion_id) {
      const ciclo = await query(
        `SELECT cultivo, variedad FROM agro_ciclos WHERE id=$1`,
        [req.params.cicloId]
      );
      await query(
        `INSERT INTO agro_movimientos_camion
           (tenant_id, camion_id, fecha, origen_tipo,
            origen_cosecha_id, cultivo, variedad,
            toneladas, entidad_externa_id)
         VALUES ($1,$2,$3,'cosecha_directa',$4,$5,$6,$7,$8)`,
        [tid(req), destino_camion_id, fecha,
         result.rows[0].id,
         ciclo.rows[0]?.cultivo || null,
         ciclo.rows[0]?.variedad || null,
         toneladas, entidad_externa_id || null]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar cosecha.' });
  }
});

router.put('/cosechas/:id', async (req, res) => {
  try {
    const { fecha, hectareas, kilos, obs,
            destino_tipo, destino_silo_id, destino_bolsa_id,
            destino_camion_id, entidad_externa_id } = req.body;

    let result;
    if (destino_tipo) {
      result = await query(
        `UPDATE agro_cosechas SET
           fecha              = COALESCE($1, fecha),
           hectareas          = COALESCE($2, hectareas),
           toneladas          = COALESCE($3, toneladas),
           obs                = COALESCE($4, obs),
           destino_tipo       = $5,
           destino_silo_id    = $6,
           destino_bolsa_id   = $7,
           destino_camion_id  = $8,
           entidad_externa_id = $9
         WHERE id=$10 AND tenant_id=$11 RETURNING *`,
        [fecha||null, hectareas??null, kilos??null, obs||null,
         destino_tipo, destino_silo_id||null, destino_bolsa_id||null,
         destino_camion_id||null, entidad_externa_id||null,
         req.params.id, tid(req)]
      );
    } else {
      result = await query(
        `UPDATE agro_cosechas SET
           fecha     = COALESCE($1, fecha),
           hectareas = COALESCE($2, hectareas),
           toneladas = COALESCE($3, toneladas),
           obs       = COALESCE($4, obs)
         WHERE id=$5 AND tenant_id=$6 RETURNING *`,
        [fecha||null, hectareas??null, kilos??null,
         obs||null, req.params.id, tid(req)]
      );
    }
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar cosecha.' });
  }
});

router.delete('/cosechas/:id', requireAdmin, async (req, res) => {
  try {
    await query(
      `DELETE FROM agro_cosechas WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar cosecha.' });
  }
});

// ── SILOS ────────────────────────────────────────────────

router.get('/silos/resumen', async (req, res) => {
  try {
    const silos = await query(
      `SELECT * FROM agro_silos WHERE tenant_id=$1 ORDER BY nombre`,
      [tid(req)]
    );
    const result = await Promise.all(silos.rows.map(async s => {
      const ton = await calcToneladasSilo(s.id, tid(req));
      return {
        ...s,
        toneladas_actuales: ton,
        toneladas_libres:   Math.max(0, s.capacidad_ton - ton),
        pct_ocupado: s.capacidad_ton > 0
          ? Math.round((ton / s.capacidad_ton) * 100)
          : 0,
      };
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener resumen de silos.' });
  }
});

router.get('/silos', async (req, res) => {
  try {
    const silos = await query(
      `SELECT * FROM agro_silos WHERE tenant_id=$1 ORDER BY nombre`,
      [tid(req)]
    );
    const result = await Promise.all(silos.rows.map(async s => ({
      ...s,
      toneladas_actuales: await calcToneladasSilo(s.id, tid(req))
    })));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener silos.' });
  }
});

router.post('/silos', requireAdmin, async (req, res) => {
  try {
    const { nombre, capacidad_ton } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });
    const result = await query(
      `INSERT INTO agro_silos (tenant_id, nombre, capacidad_ton)
       VALUES ($1,$2,$3) RETURNING *`,
      [tid(req), nombre.trim(), capacidad_ton || 0]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear silo.' });
  }
});

router.put('/silos/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre, capacidad_ton } = req.body;
    const result = await query(
      `UPDATE agro_silos SET
         nombre=COALESCE($1,nombre),
         capacidad_ton=COALESCE($2,capacidad_ton)
       WHERE id=$3 AND tenant_id=$4 RETURNING *`,
      [nombre || null, capacidad_ton ?? null, req.params.id, tid(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar silo.' });
  }
});

router.post('/silos/:id/mover', async (req, res) => {
  try {
    const { camion_id, fecha, toneladas, entidad_externa_id, obs } = req.body;
    if (!camion_id || !toneladas) {
      return res.status(400).json({ error: 'camion_id y toneladas requeridos.' });
    }
    const silo = await query(
      `SELECT * FROM agro_silos WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    if (!silo.rowCount) return res.status(404).json({ error: 'Silo no encontrado.' });

    const tonActuales = await calcToneladasSilo(req.params.id, tid(req));
    if (toneladas > tonActuales) {
      return res.status(400).json({
        error: `Solo hay ${tonActuales} toneladas disponibles en el silo.`
      });
    }

    const result = await query(
      `INSERT INTO agro_movimientos_camion
         (tenant_id, camion_id, fecha, origen_tipo,
          origen_silo_id, cultivo, toneladas,
          entidad_externa_id, obs)
       VALUES ($1,$2,$3,'silo',$4,$5,$6,$7,$8) RETURNING *`,
      [tid(req), camion_id,
       fecha || new Date().toISOString().slice(0, 10),
       req.params.id, silo.rows[0].cultivo_actual,
       toneladas, entidad_externa_id || null, obs || '']
    );

    const tonRestantes = tonActuales - toneladas;
    if (tonRestantes <= 0) {
      await query(
        `UPDATE agro_silos SET cultivo_actual=NULL WHERE id=$1`,
        [req.params.id]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al mover silo.' });
  }
});

// ── BOLSAS ───────────────────────────────────────────────

router.get('/bolsas/por-establecimiento', async (req, res) => {
  try {
    const result = await query(
      `SELECT b.*,
         c.nombre  AS ciclo_nombre,
         c.cultivo AS ciclo_cultivo,
         l.nombre  AS lote_nombre,
         l.id      AS lote_id,
         e.nombre  AS establecimiento_nombre,
         e.id      AS establecimiento_id
       FROM agro_bolsas b
       JOIN agro_ciclos c             ON c.id = b.ciclo_id
       JOIN agro_lotes l              ON l.id = c.lote_id
       JOIN agro_establecimientos e   ON e.id = l.establecimiento_id
       WHERE b.tenant_id=$1 AND b.cerrada=FALSE
       ORDER BY e.nombre, l.nombre, b.creado_en`,
      [tid(req)]
    );
    const rows = await Promise.all(result.rows.map(async b => ({
      ...b,
      toneladas_actuales: await calcToneladasBolsa(b.id, tid(req))
    })));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener bolsas.' });
  }
});

router.get('/ciclos/:cicloId/bolsas', async (req, res) => {
  try {
    const bolsas = await query(
      `SELECT * FROM agro_bolsas
       WHERE ciclo_id=$1 AND tenant_id=$2
       ORDER BY creado_en ASC`,
      [req.params.cicloId, tid(req)]
    );
    const result = await Promise.all(bolsas.rows.map(async b => ({
      ...b,
      toneladas_actuales: await calcToneladasBolsa(b.id, tid(req))
    })));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener bolsas.' });
  }
});

router.post('/ciclos/:cicloId/bolsas', async (req, res) => {
  try {
    const { nombre } = req.body;
    const ciclo = await query(
      `SELECT cultivo, variedad FROM agro_ciclos WHERE id=$1`,
      [req.params.cicloId]
    );
    const c = ciclo.rows[0];
    const result = await query(
      `INSERT INTO agro_bolsas
         (tenant_id, ciclo_id, nombre, cultivo, variedad, fecha_inicio)
       VALUES ($1,$2,$3,$4,$5,CURRENT_DATE) RETURNING *`,
      [tid(req), req.params.cicloId,
       nombre || 'Bolsa nueva', c?.cultivo || null, c?.variedad || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear bolsa.' });
  }
});

router.post('/bolsas/:id/mover', async (req, res) => {
  try {
    const { camion_id, fecha, toneladas, entidad_externa_id, obs } = req.body;
    if (!camion_id || !toneladas) {
      return res.status(400).json({ error: 'camion_id y toneladas requeridos.' });
    }

    const bolsa = await query(
      `SELECT * FROM agro_bolsas WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    if (!bolsa.rowCount) return res.status(404).json({ error: 'Bolsa no encontrada.' });

    const tonActuales = await calcToneladasBolsa(req.params.id, tid(req));
    if (toneladas > tonActuales) {
      return res.status(400).json({
        error: `Solo hay ${tonActuales} toneladas disponibles en la bolsa.`
      });
    }

    const result = await query(
      `INSERT INTO agro_movimientos_camion
         (tenant_id, camion_id, fecha, origen_tipo,
          origen_bolsa_id, cultivo, variedad,
          toneladas, entidad_externa_id, obs)
       VALUES ($1,$2,$3,'bolsa',$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tid(req), camion_id,
       fecha || new Date().toISOString().slice(0, 10),
       req.params.id,
       bolsa.rows[0].cultivo, bolsa.rows[0].variedad,
       toneladas, entidad_externa_id || null, obs || '']
    );

    const tonRestantes = tonActuales - toneladas;
    if (tonRestantes <= 0) {
      await query(
        `UPDATE agro_bolsas SET cerrada=TRUE WHERE id=$1`,
        [req.params.id]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al mover bolsa.' });
  }
});

// ── CAMIONES ─────────────────────────────────────────────

router.put('/movimientos-camion/:id', async (req, res) => {
  try {
    const { camion_id, entidad_externa_id } = req.body;
    if (!camion_id) return res.status(400).json({ error: 'camion_id requerido.' });
    const result = await query(
      `UPDATE agro_movimientos_camion
         SET camion_id          = $1,
             entidad_externa_id = $2
       WHERE id=$3 AND tenant_id=$4 RETURNING *`,
      [camion_id, entidad_externa_id||null, req.params.id, tid(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar movimiento.' });
  }
});

router.get('/camiones/movimientos', async (req, res) => {
  try {
    const { mes, anio } = req.query;
    const mesNum  = parseInt(mes)  || new Date().getMonth() + 1;
    const anioNum = parseInt(anio) || new Date().getFullYear();
    const desde = `${anioNum}-${String(mesNum).padStart(2, '0')}-01`;
    const hasta = new Date(anioNum, mesNum, 0).toISOString().slice(0, 10);

    const result = await query(
      `SELECT m.*,
         cam.nombre AS camion_nombre,
         ext.nombre AS entidad_nombre,
         s.nombre   AS silo_nombre,
         b.nombre   AS bolsa_nombre
       FROM agro_movimientos_camion m
       JOIN agro_camiones cam            ON cam.id = m.camion_id
       LEFT JOIN agro_entidades_externas ext ON ext.id = m.entidad_externa_id
       LEFT JOIN agro_silos s            ON s.id = m.origen_silo_id
       LEFT JOIN agro_bolsas b           ON b.id = m.origen_bolsa_id
       WHERE m.tenant_id=$1 AND m.fecha BETWEEN $2 AND $3
       ORDER BY m.fecha DESC, cam.nombre`,
      [tid(req), desde, hasta]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener movimientos.' });
  }
});

router.get('/camiones', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM agro_camiones WHERE tenant_id=$1 ORDER BY nombre`,
      [tid(req)]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener camiones.' });
  }
});

router.post('/camiones', requireAdmin, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });
    const result = await query(
      `INSERT INTO agro_camiones (tenant_id, nombre)
       VALUES ($1,$2) RETURNING *`,
      [tid(req), nombre.trim()]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear camión.' });
  }
});

router.put('/camiones/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre } = req.body;
    const result = await query(
      `UPDATE agro_camiones SET nombre=$1
       WHERE id=$2 AND tenant_id=$3 RETURNING *`,
      [nombre.trim(), req.params.id, tid(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar camión.' });
  }
});

router.delete('/camiones/:id', requireAdmin, async (req, res) => {
  try {
    await query(
      `DELETE FROM agro_camiones WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar camión.' });
  }
});

// ── ENTIDADES EXTERNAS ───────────────────────────────────

router.get('/entidades', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM agro_entidades_externas
       WHERE tenant_id=$1 ORDER BY nombre`,
      [tid(req)]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener entidades.' });
  }
});

router.post('/entidades', requireAdmin, async (req, res) => {
  try {
    const { nombre, tipo } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });
    const result = await query(
      `INSERT INTO agro_entidades_externas (tenant_id, nombre, tipo)
       VALUES ($1,$2,$3) RETURNING *`,
      [tid(req), nombre.trim(), tipo || 'acopiador']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear entidad.' });
  }
});

router.put('/entidades/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre, tipo } = req.body;
    const result = await query(
      `UPDATE agro_entidades_externas
       SET nombre=COALESCE($1,nombre), tipo=COALESCE($2,tipo)
       WHERE id=$3 AND tenant_id=$4 RETURNING *`,
      [nombre || null, tipo || null, req.params.id, tid(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar entidad.' });
  }
});

router.delete('/entidades/:id', requireAdmin, async (req, res) => {
  try {
    await query(
      `DELETE FROM agro_entidades_externas WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar entidad.' });
  }
});

// ── CULTIVOS ──────────────────────────────────────────────

router.get('/cultivos', async (req, res) => {
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS agro_cultivos (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id  UUID NOT NULL,
        nombre     TEXT NOT NULL,
        creado_en  TIMESTAMPTZ DEFAULT NOW()
      )`
    );
    const result = await query(
      `SELECT * FROM agro_cultivos WHERE tenant_id=$1 ORDER BY nombre`,
      [tid(req)]
    );
    if (!result.rows.length) {
      const seeds = ['Soja', 'Maíz', 'Trigo', 'Sorgo', 'Girasol'];
      for (const nombre of seeds) {
        await query(
          `INSERT INTO agro_cultivos (tenant_id, nombre) VALUES ($1,$2)`,
          [tid(req), nombre]
        );
      }
      const seeded = await query(
        `SELECT * FROM agro_cultivos WHERE tenant_id=$1 ORDER BY nombre`,
        [tid(req)]
      );
      return res.json(seeded.rows);
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener cultivos.' });
  }
});

router.post('/cultivos', requireAdmin, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido.' });
    const result = await query(
      `INSERT INTO agro_cultivos (tenant_id, nombre) VALUES ($1,$2) RETURNING *`,
      [tid(req), nombre]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear cultivo.' });
  }
});

router.delete('/cultivos/:id', requireAdmin, async (req, res) => {
  try {
    await query(
      `DELETE FROM agro_cultivos WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar cultivo.' });
  }
});

// ── TIPOS DE CULTIVO ──────────────────────────────────────

router.get('/tipos-cultivo', async (req, res) => {
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS agro_tipos_cultivo (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id  UUID NOT NULL,
        nombre     TEXT NOT NULL,
        creado_en  TIMESTAMPTZ DEFAULT NOW()
      )`
    );
    const result = await query(
      `SELECT * FROM agro_tipos_cultivo WHERE tenant_id=$1 ORDER BY nombre`,
      [tid(req)]
    );
    if (!result.rows.length) {
      for (const nombre of ['Primera', 'Segunda']) {
        await query(
          `INSERT INTO agro_tipos_cultivo (tenant_id, nombre) VALUES ($1,$2)`,
          [tid(req), nombre]
        );
      }
      const seeded = await query(
        `SELECT * FROM agro_tipos_cultivo WHERE tenant_id=$1 ORDER BY nombre`,
        [tid(req)]
      );
      return res.json(seeded.rows);
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener tipos.' });
  }
});

router.post('/tipos-cultivo', requireAdmin, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido.' });
    const result = await query(
      `INSERT INTO agro_tipos_cultivo (tenant_id, nombre) VALUES ($1,$2) RETURNING *`,
      [tid(req), nombre]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear tipo.' });
  }
});

router.delete('/tipos-cultivo/:id', requireAdmin, async (req, res) => {
  try {
    await query(
      `DELETE FROM agro_tipos_cultivo WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar tipo.' });
  }
});

module.exports = router;
