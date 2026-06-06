// src/routes/historial.js

'use strict';

const express = require('express');
const { query } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/historial — lista de ciclos cerrados
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, ciclo_id, ciclo_nombre, grupo_nombre, estancia_nombre,
              fecha_inicio, fecha_cierre, obs, stats, creado_en
       FROM historial
       WHERE tenant_id = $1
       ORDER BY fecha_cierre DESC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener historial.' });
  }
});

// GET /api/historial/:id — historial completo con vacas_snapshot
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM historial WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'No encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener historial.' });
  }
});

module.exports = router;
