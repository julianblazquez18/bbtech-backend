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
    `SELECT COALESCE(SUM(kilos),0) AS total
     FROM agro_cosecha_asignaciones
     WHERE destino_silo_id=$1 AND tenant_id=$2`,
    [siloId, tenantId]
  );
  const salidas = await query(
    `SELECT COALESCE(SUM(toneladas),0) AS total
     FROM agro_movimientos_camion
     WHERE origen_silo_id=$1 AND tenant_id=$2`,
    [siloId, tenantId]
  );
  const ajustes = await query(
    `SELECT COALESCE(SUM(kilos),0) AS total
     FROM agro_ajustes_silo
     WHERE silo_id=$1 AND tenant_id=$2`,
    [siloId, tenantId]
  );
  const total = Math.max(0,
    parseFloat(entradas.rows[0].total)
    + parseFloat(ajustes.rows[0].total)
    - parseFloat(salidas.rows[0].total)
  );
  if (total === 0) {
    await query(
      `UPDATE agro_silos SET cultivo_actual=NULL
       WHERE id=$1 AND tenant_id=$2 AND cultivo_actual IS NOT NULL`,
      [siloId, tenantId]
    );
  }
  return total;
}

async function calcToneladasBolsa(bolsaId, tenantId) {
  const bolsa = await query(
    `SELECT toneladas_totales FROM agro_bolsas WHERE id=$1`,
    [bolsaId]
  );
  const kilosIniciales = parseFloat(bolsa.rows[0]?.toneladas_totales || 0);

  const asignaciones = await query(
    `SELECT COALESCE(SUM(kilos),0) AS total
     FROM agro_cosecha_asignaciones
     WHERE destino_bolsa_id=$1 AND tenant_id=$2`,
    [bolsaId, tenantId]
  );
  const salidas = await query(
    `SELECT COALESCE(SUM(toneladas),0) AS total
     FROM agro_movimientos_camion
     WHERE origen_bolsa_id=$1 AND tenant_id=$2`,
    [bolsaId, tenantId]
  );
  const entradas = kilosIniciales + parseFloat(asignaciones.rows[0].total);
  return Math.max(0, entradas - parseFloat(salidas.rows[0].total));
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

router.put('/establecimientos/:estId/lotes/orden', requireAdmin, async (req, res) => {
  try {
    const { orden } = req.body;
    if (!Array.isArray(orden)) return res.status(400).json({ error: 'orden requerido.' });
    for (const item of orden) {
      await query(
        `UPDATE agro_lotes SET orden=$1 WHERE id=$2 AND tenant_id=$3`,
        [item.orden, item.id, tid(req)]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al reordenar.' });
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

    const loteInfoReg = await query(
      `SELECT l.hectareas FROM agro_lotes l
       JOIN agro_ciclos c ON c.lote_id = l.id
       WHERE c.id=$1`,
      [req.params.cicloId]
    );
    const maxHaReg = parseFloat(loteInfoReg.rows[0]?.hectareas || 0);
    if (maxHaReg > 0 && hectareas) {
      if (tipo === 'siembra') {
        const yaReg = await query(
          `SELECT COALESCE(SUM(hectareas),0) AS total
           FROM agro_registros
           WHERE ciclo_id=$1 AND tipo=$2`,
          [req.params.cicloId, tipo]
        );
        const totalHa = parseFloat(yaReg.rows[0].total) + parseFloat(hectareas);
        if (totalHa > maxHaReg) {
          return res.status(400).json({
            error: `Las hectáreas de siembra (${totalHa} ha) superan las del lote (${maxHaReg} ha). Máximo disponible: ${(maxHaReg - parseFloat(yaReg.rows[0].total)).toFixed(1)} ha.`
          });
        }
      } else if (tipo === 'fertilizacion' || tipo === 'pulverizacion') {
        if (parseFloat(hectareas) > maxHaReg) {
          return res.status(400).json({
            error: `Las hectáreas de ${tipo} (${hectareas} ha) superan las del lote (${maxHaReg} ha). Máximo por registro: ${maxHaReg} ha.`
          });
        }
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

    if (destino_tipo && !['silo', 'bolsa', 'camion'].includes(destino_tipo)) {
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

    const loteInfoCos = await query(
      `SELECT l.hectareas FROM agro_lotes l
       JOIN agro_ciclos c ON c.lote_id = l.id
       WHERE c.id=$1`,
      [req.params.cicloId]
    );
    const maxHaCos = parseFloat(loteInfoCos.rows[0]?.hectareas || 0);
    if (maxHaCos > 0 && hectareas) {
      const yaCos = await query(
        `SELECT COALESCE(SUM(hectareas),0) AS total
         FROM agro_cosechas WHERE ciclo_id=$1`,
        [req.params.cicloId]
      );
      const totalHaCos = parseFloat(yaCos.rows[0].total) + parseFloat(hectareas);
      if (totalHaCos > maxHaCos) {
        return res.status(400).json({
          error: `Las hectáreas de cosecha (${totalHaCos} ha) superan las del lote (${maxHaCos} ha). Máximo disponible: ${maxHaCos - parseFloat(yaCos.rows[0].total)} ha.`
        });
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

router.post('/cosechas/:id/asignar-destino', async (req, res) => {
  try {
    const { destino_tipo, destino_silo_id, destino_bolsa_id,
            destino_camion_id, entidad_externa_id, kilos } = req.body;

    if (!destino_tipo || !kilos || kilos <= 0) {
      return res.status(400).json({ error: 'destino_tipo y kilos requeridos.' });
    }

    const cosecha = await query(
      `SELECT c.*, ag.cultivo FROM agro_cosechas c
       JOIN agro_ciclos ag ON ag.id = c.ciclo_id
       WHERE c.id=$1 AND c.tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    if (!cosecha.rowCount) return res.status(404).json({ error: 'Cosecha no encontrada.' });

    const c = cosecha.rows[0];

    if (c.destino_tipo) {
      // Cosecha ya tiene destino — crear asignación parcial adicional
      const result = await query(
        `INSERT INTO agro_cosechas
           (tenant_id, ciclo_id, fecha, hectareas, toneladas,
            destino_tipo, destino_silo_id, destino_bolsa_id,
            destino_camion_id, entidad_externa_id)
         VALUES ($1,$2,CURRENT_DATE,null,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [tid(req), c.ciclo_id, kilos, destino_tipo,
         destino_silo_id||null, destino_bolsa_id||null,
         destino_camion_id||null, entidad_externa_id||null]
      );
      if (destino_tipo === 'bolsa' && destino_bolsa_id) {
        await query(
          `UPDATE agro_bolsas SET toneladas_totales = toneladas_totales + $1 WHERE id=$2`,
          [kilos, destino_bolsa_id]
        );
      }
      if (destino_tipo === 'camion' && destino_camion_id) {
        await query(
          `INSERT INTO agro_movimientos_camion
             (tenant_id, camion_id, fecha, origen_tipo, origen_cosecha_id,
              cultivo, toneladas, entidad_externa_id)
           VALUES ($1,$2,CURRENT_DATE,'cosecha_directa',$3,$4,$5,$6)`,
          [tid(req), destino_camion_id, result.rows[0].id,
           c.cultivo||null, kilos, entidad_externa_id||null]
        );
      }
      return res.json(result.rows[0]);
    }

    // Cosecha sin destino: actualizar la cosecha existente
    const tonAsignar = Math.min(parseFloat(kilos), parseFloat(c.toneladas || 0));
    await query(
      `UPDATE agro_cosechas SET
         destino_tipo=$1, destino_silo_id=$2, destino_bolsa_id=$3,
         destino_camion_id=$4, entidad_externa_id=$5, toneladas=$6
       WHERE id=$7 AND tenant_id=$8`,
      [destino_tipo, destino_silo_id||null, destino_bolsa_id||null,
       destino_camion_id||null, entidad_externa_id||null,
       tonAsignar, req.params.id, tid(req)]
    );
    if (destino_tipo === 'silo' && destino_silo_id) {
      await query(
        `UPDATE agro_silos SET cultivo_actual=COALESCE(cultivo_actual,$1) WHERE id=$2`,
        [c.cultivo||null, destino_silo_id]
      );
    }
    if (destino_tipo === 'bolsa' && destino_bolsa_id) {
      await query(
        `UPDATE agro_bolsas SET toneladas_totales=toneladas_totales+$1 WHERE id=$2`,
        [tonAsignar, destino_bolsa_id]
      );
    }
    if (destino_tipo === 'camion' && destino_camion_id) {
      await query(
        `INSERT INTO agro_movimientos_camion
           (tenant_id, camion_id, fecha, origen_tipo, origen_cosecha_id,
            cultivo, toneladas, entidad_externa_id)
         VALUES ($1,$2,CURRENT_DATE,'cosecha_directa',$3,$4,$5,$6)`,
        [tid(req), destino_camion_id, req.params.id,
         c.cultivo||null, tonAsignar, entidad_externa_id||null]
      );
    }
    const updated = await query(
      `SELECT * FROM agro_cosechas WHERE id=$1`, [req.params.id]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al asignar destino.' });
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

// ── ASIGNACIONES DE COSECHA ──────────────────────────────

router.get('/ciclos/:cicloId/asignaciones', async (req, res) => {
  try {
    const result = await query(
      `SELECT a.*,
         s.nombre   AS silo_nombre,
         b.nombre   AS bolsa_nombre,
         cam.nombre AS camion_nombre,
         ext.nombre AS entidad_nombre
       FROM agro_cosecha_asignaciones a
       LEFT JOIN agro_silos s              ON s.id = a.destino_silo_id
       LEFT JOIN agro_bolsas b             ON b.id = a.destino_bolsa_id
       LEFT JOIN agro_camiones cam         ON cam.id = a.destino_camion_id
       LEFT JOIN agro_entidades_externas ext ON ext.id = a.entidad_externa_id
       WHERE a.ciclo_id=$1 AND a.tenant_id=$2
       ORDER BY a.creado_en ASC`,
      [req.params.cicloId, tid(req)]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener asignaciones.' });
  }
});

router.post('/ciclos/:cicloId/asignaciones', async (req, res) => {
  try {
    const { kilos, destino_tipo, destino_silo_id, destino_bolsa_id,
            destino_camion_id, entidad_externa_id } = req.body;

    if (!kilos || kilos <= 0 || !destino_tipo) {
      return res.status(400).json({ error: 'kilos y destino_tipo requeridos.' });
    }
    const TIPOS_VALIDOS = ['silo','bolsa','camion','siembra','externo'];
    if (!TIPOS_VALIDOS.includes(destino_tipo)) {
      return res.status(400).json({ error: 'Tipo de destino inválido.' });
    }

    const totalCosechado = await query(
      `SELECT COALESCE(SUM(toneladas),0) AS total
       FROM agro_cosechas WHERE ciclo_id=$1 AND tenant_id=$2`,
      [req.params.cicloId, tid(req)]
    );
    const totalAsignado = await query(
      `SELECT COALESCE(SUM(kilos),0) AS total
       FROM agro_cosecha_asignaciones WHERE ciclo_id=$1 AND tenant_id=$2`,
      [req.params.cicloId, tid(req)]
    );
    const disponible = parseFloat(totalCosechado.rows[0].total)
                     - parseFloat(totalAsignado.rows[0].total);

    if (parseFloat(kilos) > disponible) {
      return res.status(400).json({
        error: `Solo hay ${disponible} kg disponibles para asignar.`
      });
    }

    const result = await query(
      `INSERT INTO agro_cosecha_asignaciones
         (tenant_id, ciclo_id, fecha, kilos, destino_tipo,
          destino_silo_id, destino_bolsa_id,
          destino_camion_id, entidad_externa_id)
       VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tid(req), req.params.cicloId, kilos, destino_tipo,
       destino_silo_id||null, destino_bolsa_id||null,
       destino_camion_id||null, entidad_externa_id||null]
    );

    if (destino_tipo === 'silo' && destino_silo_id) {
      const cicloInfo = await query(
        `SELECT cultivo FROM agro_ciclos WHERE id=$1`, [req.params.cicloId]
      );
      const cultivo = cicloInfo.rows[0]?.cultivo;
      const siloInfo = await query(
        `SELECT cultivo_actual FROM agro_silos WHERE id=$1`, [destino_silo_id]
      );
      const siloCult = siloInfo.rows[0]?.cultivo_actual;
      if (siloCult && cultivo && siloCult !== cultivo) {
        return res.status(400).json({
          error: `El silo ya tiene "${siloCult}". No podés mezclar cultivos.`
        });
      }
      if (!siloCult && cultivo) {
        await query(
          `UPDATE agro_silos SET cultivo_actual=$1 WHERE id=$2`,
          [cultivo, destino_silo_id]
        );
      }
    }
    if (destino_tipo === 'camion' && destino_camion_id) {
      const cicloInfo = await query(
        `SELECT cultivo FROM agro_ciclos WHERE id=$1`, [req.params.cicloId]
      );
      await query(
        `INSERT INTO agro_movimientos_camion
           (tenant_id, camion_id, fecha, origen_tipo,
            cultivo, toneladas, entidad_externa_id)
         VALUES ($1,$2,CURRENT_DATE,'cosecha_asignada',$3,$4,$5)`,
        [tid(req), destino_camion_id,
         cicloInfo.rows[0]?.cultivo||null,
         kilos, entidad_externa_id||null]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear asignación.' });
  }
});

router.delete('/asignaciones/:id', requireAdmin, async (req, res) => {
  try {
    const asig = await query(
      `SELECT * FROM agro_cosecha_asignaciones WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    if (!asig.rowCount) return res.status(404).json({ error: 'No encontrada.' });
    const a = asig.rows[0];

    if (a.destino_tipo === 'bolsa' && a.destino_bolsa_id) {
      await query(
        `UPDATE agro_bolsas SET toneladas_totales=GREATEST(0,toneladas_totales-$1)
         WHERE id=$2`, [a.kilos, a.destino_bolsa_id]
      );
    }

    await query(
      `DELETE FROM agro_cosecha_asignaciones WHERE id=$1`, [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar asignación.' });
  }
});

// ── SILOS ────────────────────────────────────────────────

router.get('/silos/resumen', async (req, res) => {
  try {
    const silos = await query(
      `SELECT * FROM agro_silos WHERE tenant_id=$1 ORDER BY orden ASC, nombre`,
      [tid(req)]
    );
    const result = await Promise.all(silos.rows.map(async s => {
      const ton = await calcToneladasSilo(s.id, tid(req));
      const caps = await query(
        `SELECT cultivo, capacidad_kg FROM agro_silo_capacidades
         WHERE silo_id=$1 AND tenant_id=$2 ORDER BY cultivo`,
        [s.id, tid(req)]
      );
      const cultActual   = ton === 0 ? null : s.cultivo_actual;
      const capCultivo   = cultActual
        ? caps.rows.find(c => c.cultivo === cultActual)?.capacidad_kg
        : null;
      const capMax       = caps.rows.length > 0
        ? Math.max(...caps.rows.map(c => parseFloat(c.capacidad_kg || 0)))
        : 0;
      const capEfectiva  = parseFloat(capCultivo || capMax || s.capacidad_ton || 0);
      return {
        ...s,
        cultivo_actual:     cultActual,
        toneladas_actuales: ton,
        toneladas_libres:   capEfectiva > 0 ? Math.max(0, capEfectiva - ton) : null,
        pct_ocupado:        capEfectiva > 0 ? Math.round((ton / capEfectiva) * 100) : null,
        disponible:         ton === 0,
        capacidades:        caps.rows,
        capacidad_efectiva: capEfectiva,
      };
    }));
    res.json(result);
  } catch (err) {
    console.error('RESUMEN ERROR:', err.message, err.stack);
    res.status(500).json({ error: 'Error al obtener resumen de silos.' });
  }
});

router.get('/silos', async (req, res) => {
  try {
    const silos = await query(
      `SELECT * FROM agro_silos WHERE tenant_id=$1 ORDER BY orden ASC, nombre`,
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
    const { nombre, capacidades } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });
    const result = await query(
      `INSERT INTO agro_silos (tenant_id, nombre) VALUES ($1,$2) RETURNING *`,
      [tid(req), nombre.trim()]
    );
    if (Array.isArray(capacidades)) {
      for (const cap of capacidades) {
        if (cap.cultivo && parseFloat(cap.capacidad_kg) > 0) {
          await query(
            `INSERT INTO agro_silo_capacidades
               (tenant_id, silo_id, cultivo, capacidad_kg)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (silo_id, cultivo)
             DO UPDATE SET capacidad_kg=$4`,
            [tid(req), result.rows[0].id, cap.cultivo, cap.capacidad_kg]
          );
        }
      }
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear silo.' });
  }
});

router.put('/silos/orden', requireAdmin, async (req, res) => {
  try {
    const { orden } = req.body;
    if (!Array.isArray(orden)) return res.status(400).json({ error: 'orden requerido.' });
    for (const item of orden) {
      await query(
        `UPDATE agro_silos SET orden=$1 WHERE id=$2 AND tenant_id=$3`,
        [item.orden, item.id, tid(req)]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al reordenar silos.' });
  }
});

router.put('/silos/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre, capacidades } = req.body;
    const result = await query(
      `UPDATE agro_silos SET nombre=COALESCE($1,nombre)
       WHERE id=$2 AND tenant_id=$3 RETURNING *`,
      [nombre || null, req.params.id, tid(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });
    if (Array.isArray(capacidades)) {
      for (const cap of capacidades) {
        if (cap.cultivo) {
          const kg = parseFloat(cap.capacidad_kg || 0);
          if (kg > 0) {
            await query(
              `INSERT INTO agro_silo_capacidades
                 (tenant_id, silo_id, cultivo, capacidad_kg)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (silo_id, cultivo)
               DO UPDATE SET capacidad_kg=$4`,
              [tid(req), req.params.id, cap.cultivo, kg]
            );
          } else {
            await query(
              `DELETE FROM agro_silo_capacidades
               WHERE silo_id=$1 AND cultivo=$2 AND tenant_id=$3`,
              [req.params.id, cap.cultivo, tid(req)]
            );
          }
        }
      }
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar silo.' });
  }
});

router.post('/silos/:id/mover', async (req, res) => {
  try {
    const { camion_id, fecha, toneladas, entidad_externa_id,
            destino_categoria, destino_bolsa_id } = req.body;
    if (!toneladas) return res.status(400).json({ error: 'toneladas requerido.' });
    if (!destino_categoria) {
      return res.status(400).json({ error: 'destino_categoria requerido.' });
    }

    const silo = await query(
      `SELECT * FROM agro_silos WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    if (!silo.rowCount) return res.status(404).json({ error: 'Silo no encontrado.' });
    const s = silo.rows[0];

    const tonActuales = await calcToneladasSilo(req.params.id, tid(req));
    if (toneladas > tonActuales) {
      return res.status(400).json({
        error: `Solo hay ${tonActuales} kg disponibles en el silo.`
      });
    }

    if (destino_categoria === 'bolsa' && destino_bolsa_id) {
      const bolsa = await query(
        `SELECT * FROM agro_bolsas WHERE id=$1 AND tenant_id=$2`,
        [destino_bolsa_id, tid(req)]
      );
      if (!bolsa.rowCount) return res.status(404).json({ error: 'Bolsa no encontrada.' });
      const b = bolsa.rows[0];
      if (b.cultivo && s.cultivo_actual && b.cultivo !== s.cultivo_actual) {
        return res.status(400).json({
          error: `La bolsa tiene "${b.cultivo}" y el silo tiene "${s.cultivo_actual}". No se pueden mezclar.`
        });
      }
      if (!b.cultivo && s.cultivo_actual) {
        await query(
          `UPDATE agro_bolsas SET cultivo=$1 WHERE id=$2`,
          [s.cultivo_actual, destino_bolsa_id]
        );
      }
      await query(
        `UPDATE agro_bolsas SET toneladas_totales=toneladas_totales+$1 WHERE id=$2`,
        [toneladas, destino_bolsa_id]
      );
    }

    await query(
      `INSERT INTO agro_movimientos_camion
         (tenant_id, camion_id, fecha, origen_tipo, origen_silo_id,
          cultivo, toneladas, entidad_externa_id, destino_categoria)
       VALUES ($1,$2,$3,'silo',$4,$5,$6,$7,$8)`,
      [tid(req),
       destino_categoria === 'camion' ? camion_id : null,
       fecha || new Date().toISOString().slice(0,10),
       req.params.id, s.cultivo_actual,
       toneladas,
       destino_categoria === 'camion' ? entidad_externa_id||null : null,
       destino_categoria]
    );

    const tonRestantes = tonActuales - toneladas;
    if (tonRestantes <= 0) {
      await query(
        `UPDATE agro_silos SET cultivo_actual=NULL WHERE id=$1`,
        [req.params.id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al mover silo.' });
  }
});

router.post('/silos/:id/ajustar', requireAdmin, async (req, res) => {
  try {
    const { cultivo_nuevo, kilos_ajuste, obs } = req.body;
    const silo = await query(
      `SELECT * FROM agro_silos WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    if (!silo.rowCount) return res.status(404).json({ error: 'Silo no encontrado.' });
    const s = silo.rows[0];

    const kilosActuales = await calcToneladasSilo(req.params.id, tid(req));
    const cultivoFinal  = cultivo_nuevo !== undefined
      ? cultivo_nuevo : s.cultivo_actual;

    if (cultivo_nuevo !== undefined && cultivo_nuevo !== s.cultivo_actual) {
      if (kilosActuales > 0) {
        const capNueva = await query(
          `SELECT capacidad_kg FROM agro_silo_capacidades
           WHERE silo_id=$1 AND cultivo=$2`,
          [req.params.id, cultivo_nuevo]
        );
        const maxNuevo = parseFloat(capNueva.rows[0]?.capacidad_kg || 0);
        if (maxNuevo > 0 && kilosActuales > maxNuevo) {
          return res.status(400).json({
            error: `El silo tiene ${kilosActuales} kg de ${s.cultivo_actual||'cultivo actual'}. La capacidad máxima para ${cultivo_nuevo} es ${maxNuevo} kg. Reducí los kilos primero.`
          });
        }
      }
    }

    if (kilos_ajuste) {
      const nuevosKilos = kilosActuales + parseFloat(kilos_ajuste);
      if (nuevosKilos < 0) {
        return res.status(400).json({
          error: `El ajuste dejaría el silo en ${nuevosKilos} kg. Mínimo permitido: 0 kg.`
        });
      }
      const capCult = await query(
        `SELECT capacidad_kg FROM agro_silo_capacidades
         WHERE silo_id=$1 AND cultivo=$2`,
        [req.params.id, cultivoFinal || s.cultivo_actual]
      );
      const maxCap = parseFloat(capCult.rows[0]?.capacidad_kg || 0);
      if (maxCap > 0 && nuevosKilos > maxCap) {
        return res.status(400).json({
          error: `El ajuste dejaría el silo con ${nuevosKilos} kg, superando la capacidad máxima de ${maxCap} kg para ${cultivoFinal || s.cultivo_actual}.`
        });
      }
    }

    await query(
      `INSERT INTO agro_ajustes_silo
         (tenant_id, silo_id, tipo, kilos, cultivo_anterior, cultivo_nuevo, obs)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid(req), req.params.id,
       cultivo_nuevo && cultivo_nuevo !== s.cultivo_actual ? 'cambio_cultivo' : 'ajuste',
       kilos_ajuste || 0,
       s.cultivo_actual, cultivo_nuevo || s.cultivo_actual, obs || '']
    );

    if (cultivo_nuevo && cultivo_nuevo !== s.cultivo_actual) {
      await query(
        `UPDATE agro_silos SET cultivo_actual=$1 WHERE id=$2`,
        [cultivo_nuevo || null, req.params.id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al ajustar silo.' });
  }
});

// ── BOLSAS ───────────────────────────────────────────────

router.get('/bolsas/por-establecimiento', async (req, res) => {
  try {
    const result = await query(
      `SELECT b.*,
         l.nombre AS lote_nombre,
         l.id     AS lote_id,
         e.nombre AS establecimiento_nombre,
         e.id     AS establecimiento_id
       FROM agro_bolsas b
       JOIN agro_lotes l              ON l.id = b.lote_id
       JOIN agro_establecimientos e   ON e.id = l.establecimiento_id
       WHERE b.tenant_id=$1 AND b.cerrada=FALSE
       ORDER BY e.nombre, l.nombre, b.creado_en`,
      [tid(req)]
    );
    const rows = await Promise.all(result.rows.map(async b => {
      const actuales = await calcToneladasBolsa(b.id, tid(req));
      const asignaciones = await query(
        `SELECT COALESCE(SUM(kilos),0) AS total
         FROM agro_cosecha_asignaciones
         WHERE destino_bolsa_id=$1 AND tenant_id=$2`,
        [b.id, tid(req)]
      );
      const totalIngresado = parseFloat(b.toneladas_totales || 0)
                           + parseFloat(asignaciones.rows[0].total || 0);
      return {
        ...b,
        toneladas_actuales: actuales,
        total_ingresado:    totalIngresado,
      };
    }));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener bolsas.' });
  }
});

router.get('/ciclos/:cicloId/bolsas', async (req, res) => {
  try {
    const bolsas = await query(
      `SELECT b.* FROM agro_bolsas b
       JOIN agro_ciclos c ON c.lote_id = b.lote_id
       WHERE c.id=$1 AND b.tenant_id=$2
       ORDER BY b.creado_en ASC`,
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

router.post('/bolsas', async (req, res) => {
  try {
    const { lote_id, nombre, cultivo, kilos, tipo, variedad } = req.body;
    if (!lote_id) return res.status(400).json({ error: 'lote_id requerido.' });
    const lote = await query(
      `SELECT * FROM agro_lotes WHERE id=$1 AND tenant_id=$2`,
      [lote_id, tid(req)]
    );
    if (!lote.rowCount) return res.status(404).json({ error: 'Lote no encontrado.' });
    const kgNum = kilos ? parseFloat(kilos) : null;
    const result = await query(
      `INSERT INTO agro_bolsas
         (tenant_id, lote_id, nombre, cultivo, tipo, variedad,
          toneladas_totales, fecha_inicio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE) RETURNING *`,
      [tid(req), lote_id, nombre || 'Bolsa nueva',
       cultivo || null, tipo || null, variedad || null,
       kgNum || 0]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear bolsa.' });
  }
});

router.post('/bolsas/:id/mover', async (req, res) => {
  try {
    const { camion_id, fecha, toneladas, entidad_externa_id,
            destino_categoria, destino_silo_id } = req.body;
    if (!toneladas) return res.status(400).json({ error: 'toneladas requerido.' });
    if (!destino_categoria) {
      return res.status(400).json({ error: 'destino_categoria requerido.' });
    }

    const bolsa = await query(
      `SELECT * FROM agro_bolsas WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    if (!bolsa.rowCount) return res.status(404).json({ error: 'Bolsa no encontrada.' });
    const b = bolsa.rows[0];

    const tonActuales = await calcToneladasBolsa(req.params.id, tid(req));
    if (toneladas > tonActuales) {
      return res.status(400).json({
        error: `Solo hay ${tonActuales} kg disponibles en la bolsa.`
      });
    }

    if (destino_categoria === 'silo' && destino_silo_id) {
      const silo = await query(
        `SELECT * FROM agro_silos WHERE id=$1 AND tenant_id=$2`,
        [destino_silo_id, tid(req)]
      );
      if (!silo.rowCount) return res.status(404).json({ error: 'Silo no encontrado.' });
      const s = silo.rows[0];
      if (s.cultivo_actual && b.cultivo && s.cultivo_actual !== b.cultivo) {
        return res.status(400).json({
          error: `El silo tiene "${s.cultivo_actual}" y la bolsa tiene "${b.cultivo}". No se pueden mezclar.`
        });
      }
      await query(
        `INSERT INTO agro_ajustes_silo
           (tenant_id, silo_id, tipo, kilos, cultivo_nuevo, obs)
         VALUES ($1,$2,'ajuste',$3,$4,'Recibido desde silo bolsa')`,
        [tid(req), destino_silo_id, toneladas, b.cultivo||null]
      );
      if (!s.cultivo_actual && b.cultivo) {
        await query(
          `UPDATE agro_silos SET cultivo_actual=$1 WHERE id=$2`,
          [b.cultivo, destino_silo_id]
        );
      }
    }

    await query(
      `INSERT INTO agro_movimientos_camion
         (tenant_id, camion_id, fecha, origen_tipo, origen_bolsa_id,
          cultivo, variedad, toneladas, entidad_externa_id, destino_categoria)
       VALUES ($1,$2,$3,'bolsa',$4,$5,$6,$7,$8,$9)`,
      [tid(req),
       destino_categoria === 'camion' ? camion_id : null,
       fecha || new Date().toISOString().slice(0,10),
       req.params.id, b.cultivo, b.tipo,
       toneladas,
       destino_categoria === 'camion' ? entidad_externa_id||null : null,
       destino_categoria]
    );

    const tonRestantes = tonActuales - toneladas;
    if (tonRestantes <= 0) {
      await query(
        `UPDATE agro_bolsas SET cerrada=TRUE WHERE id=$1`, [req.params.id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al mover bolsa.' });
  }
});

router.delete('/bolsas/:id', requireAdmin, async (req, res) => {
  try {
    const ton = await calcToneladasBolsa(req.params.id, tid(req));
    if (ton > 0) {
      return res.status(400).json({
        error: `La bolsa tiene ${ton} kg. Solo se pueden eliminar bolsas vacías.`
      });
    }
    await query(
      `DELETE FROM agro_bolsas WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar bolsa.' });
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

router.delete('/movimientos-camion/:id', requireAdmin, async (req, res) => {
  try {
    await query(
      `DELETE FROM agro_movimientos_camion WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar movimiento.' });
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
         b.nombre   AS bolsa_nombre,
         l.nombre   AS lote_nombre,
         e.nombre   AS establecimiento_nombre
       FROM agro_movimientos_camion m
       JOIN agro_camiones cam                ON cam.id = m.camion_id
       LEFT JOIN agro_entidades_externas ext  ON ext.id = m.entidad_externa_id
       LEFT JOIN agro_silos s                 ON s.id = m.origen_silo_id
       LEFT JOIN agro_bolsas b                ON b.id = m.origen_bolsa_id
       LEFT JOIN agro_lotes l                 ON l.id = b.lote_id
       LEFT JOIN agro_establecimientos e      ON e.id = l.establecimiento_id
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

// ── CATÁLOGO PRODUCTOS FERTILIZACIÓN ─────────────────

router.get('/productos-fert', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM agro_productos_fert
       WHERE tenant_id=$1 ORDER BY nombre`,
      [tid(req)]
    );
    if (!result.rowCount) {
      const defaults = ['Urea','MAP','DAP','Nitrato de amonio',
        'Superfosfato simple','Cloruro de potasio'];
      for (const nombre of defaults) {
        await query(
          `INSERT INTO agro_productos_fert (tenant_id, nombre)
           VALUES ($1,$2)`,
          [tid(req), nombre]
        );
      }
      const r2 = await query(
        `SELECT * FROM agro_productos_fert
         WHERE tenant_id=$1 ORDER BY nombre`,
        [tid(req)]
      );
      return res.json(r2.rows);
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error.' });
  }
});

router.post('/productos-fert', requireAdmin, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });
    const r = await query(
      `INSERT INTO agro_productos_fert (tenant_id, nombre)
       VALUES ($1,$2) RETURNING *`,
      [tid(req), nombre.trim()]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error.' });
  }
});

router.delete('/productos-fert/:id', requireAdmin, async (req, res) => {
  try {
    await query(
      `DELETE FROM agro_productos_fert WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error.' });
  }
});

// ── CATÁLOGO PRODUCTOS PULVERIZACIÓN ─────────────────

router.get('/productos-pulv', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM agro_productos_pulv
       WHERE tenant_id=$1 ORDER BY nombre`,
      [tid(req)]
    );
    if (!result.rowCount) {
      const defaults = ['Glifosato','2,4D','Atrazina','Cipermetrina',
        'Clorpirifos','Mancozeb','Captan'];
      for (const nombre of defaults) {
        await query(
          `INSERT INTO agro_productos_pulv (tenant_id, nombre)
           VALUES ($1,$2)`,
          [tid(req), nombre]
        );
      }
      const r2 = await query(
        `SELECT * FROM agro_productos_pulv
         WHERE tenant_id=$1 ORDER BY nombre`,
        [tid(req)]
      );
      return res.json(r2.rows);
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error.' });
  }
});

router.post('/productos-pulv', requireAdmin, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });
    const r = await query(
      `INSERT INTO agro_productos_pulv (tenant_id, nombre)
       VALUES ($1,$2) RETURNING *`,
      [tid(req), nombre.trim()]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error.' });
  }
});

router.delete('/productos-pulv/:id', requireAdmin, async (req, res) => {
  try {
    await query(
      `DELETE FROM agro_productos_pulv WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error.' });
  }
});

// ── PULVERIZACIÓN MULTI-PRODUCTO ─────────────────────

router.get('/ciclos/:cicloId/pulverizaciones', async (req, res) => {
  try {
    const grupos = await query(
      `SELECT * FROM agro_pulv_grupos
       WHERE ciclo_id=$1 AND tenant_id=$2
       ORDER BY fecha ASC`,
      [req.params.cicloId, tid(req)]
    );
    const result = await Promise.all(grupos.rows.map(async g => {
      const prods = await query(
        `SELECT * FROM agro_pulv_productos
         WHERE grupo_id=$1 ORDER BY creado_en ASC`,
        [g.id]
      );
      return { ...g, productos: prods.rows };
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener pulverizaciones.' });
  }
});

router.post('/ciclos/:cicloId/pulverizaciones', async (req, res) => {
  try {
    const { fecha, hectareas, productos, obs } = req.body;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida.' });
    if (!Array.isArray(productos) || !productos.length) {
      return res.status(400).json({ error: 'Al menos un producto requerido.' });
    }

    const loteInfo = await query(
      `SELECT l.hectareas FROM agro_lotes l
       JOIN agro_ciclos c ON c.lote_id = l.id
       WHERE c.id=$1`,
      [req.params.cicloId]
    );
    const maxHa = parseFloat(loteInfo.rows[0]?.hectareas || 0);
    if (maxHa > 0 && hectareas && parseFloat(hectareas) > maxHa) {
      return res.status(400).json({
        error: `Las hectáreas (${hectareas}) superan las del lote (${maxHa} ha).`
      });
    }

    const grupo = await query(
      `INSERT INTO agro_pulv_grupos
         (tenant_id, ciclo_id, fecha, hectareas, obs)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [tid(req), req.params.cicloId, fecha,
       hectareas || null, obs || '']
    );
    const grupoId = grupo.rows[0].id;

    for (const p of productos) {
      if (p.producto) {
        await query(
          `INSERT INTO agro_pulv_productos
             (tenant_id, grupo_id, producto, litros)
           VALUES ($1,$2,$3,$4)`,
          [tid(req), grupoId, p.producto, p.litros || null]
        );
      }
    }

    const prods = await query(
      `SELECT * FROM agro_pulv_productos WHERE grupo_id=$1`,
      [grupoId]
    );
    res.json({ ...grupo.rows[0], productos: prods.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar pulverización.' });
  }
});

router.put('/pulverizaciones/:id', async (req, res) => {
  try {
    const { fecha, hectareas, productos, obs } = req.body;
    const result = await query(
      `UPDATE agro_pulv_grupos SET
         fecha     = COALESCE($1, fecha),
         hectareas = COALESCE($2, hectareas),
         obs       = COALESCE($3, obs)
       WHERE id=$4 AND tenant_id=$5 RETURNING *`,
      [fecha || null, hectareas ?? null, obs ?? null,
       req.params.id, tid(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No encontrado.' });

    if (Array.isArray(productos)) {
      await query(
        `DELETE FROM agro_pulv_productos WHERE grupo_id=$1`,
        [req.params.id]
      );
      for (const p of productos) {
        if (p.producto) {
          await query(
            `INSERT INTO agro_pulv_productos
               (tenant_id, grupo_id, producto, litros)
             VALUES ($1,$2,$3,$4)`,
            [tid(req), req.params.id, p.producto, p.litros || null]
          );
        }
      }
    }
    const prods = await query(
      `SELECT * FROM agro_pulv_productos WHERE grupo_id=$1`,
      [req.params.id]
    );
    res.json({ ...result.rows[0], productos: prods.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar pulverización.' });
  }
});

router.delete('/pulverizaciones/:id', async (req, res) => {
  try {
    await query(
      `DELETE FROM agro_pulv_grupos WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar.' });
  }
});

module.exports = router;
