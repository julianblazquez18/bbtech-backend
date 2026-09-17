'use strict';

const express = require('express');
const { query } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/toros
router.get('/', async (req, res) => {
  try {
    const tid = req.user.tenantId;
    const result = await query(
      `SELECT
         t.id, t.caravana, t.ciclo_id, t.creado_en,
         c.nombre   AS ciclo_nombre,
         g.nombre   AS rodeo_nombre,
         g.id       AS rodeo_id,
         e.nombre   AS campo_nombre,
         e.id       AS campo_id
       FROM toros t
       LEFT JOIN ciclos c    ON c.id = t.ciclo_id
       LEFT JOIN grupos g    ON g.id = c.grupo_id
       LEFT JOIN estancias e ON e.id = g.estancia_id
       WHERE t.tenant_id = $1
       ORDER BY t.caravana ASC`,
      [tid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener toros.' });
  }
});

// POST /api/toros
// Body: { caravanas: ['EF394DF', 'EF394DG', ...] }
router.post('/', async (req, res) => {
  try {
    const tid = req.user.tenantId;
    const { caravanas } = req.body;

    if (!Array.isArray(caravanas) || !caravanas.length) {
      return res.status(400).json({ error: 'Se requiere array de caravanas.' });
    }

    const creados = [];
    const duplicados = [];

    for (const caravana of caravanas) {
      const car = String(caravana).trim().toUpperCase();
      if (!car) continue;
      try {
        const r = await query(
          `INSERT INTO toros (tenant_id, caravana)
           VALUES ($1, $2)
           RETURNING *`,
          [tid, car]
        );
        creados.push(r.rows[0]);
      } catch (e) {
        if (e.code === '23505') {
          duplicados.push(car);
        } else {
          throw e;
        }
      }
    }

    res.json({ creados, duplicados });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear toros.' });
  }
});

// PUT /api/toros/:id
// Body: { caravana?: string, ciclo_id?: string | null }
router.put('/:id', async (req, res) => {
  try {
    const tid = req.user.tenantId;
    const { caravana, ciclo_id } = req.body;

    const result = await query(
      `UPDATE toros SET
         caravana = COALESCE($1, caravana),
         ciclo_id = $2
       WHERE id = $3 AND tenant_id = $4
       RETURNING *`,
      [
        caravana ? String(caravana).trim().toUpperCase() : null,
        ciclo_id || null,
        req.params.id,
        tid,
      ]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: 'Toro no encontrado.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un toro con esa caravana.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar toro.' });
  }
});

// DELETE /api/toros/:id
router.delete('/:id', async (req, res) => {
  try {
    const tid = req.user.tenantId;
    const result = await query(
      `DELETE FROM toros WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tid]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Toro no encontrado.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar toro.' });
  }
});

module.exports = router;
