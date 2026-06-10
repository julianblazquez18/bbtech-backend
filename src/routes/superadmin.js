// src/routes/superadmin.js
// Rutas exclusivas para el superadmin — gestión de tenants

'use strict';

const express = require('express');
const { query } = require('../db/pool');
const { authMiddleware, requireSuperadmin } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(requireSuperadmin);

// GET /api/superadmin/tenants — lista todos los tenants con stats básicos
router.get('/tenants', async (req, res) => {
  try {
    const result = await query(
      `SELECT
         t.id, t.nombre, t.empresa_nombre, t.email_contacto,
         t.aprobado, t.plan, t.creado_en,
         COUNT(u.id) AS usuario_count
       FROM tenants t
       LEFT JOIN usuarios u ON u.tenant_id = t.id
       GROUP BY t.id
       ORDER BY t.creado_en DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('superadmin/tenants:', err);
    res.status(500).json({ error: 'Error al obtener tenants.' });
  }
});

// PUT /api/superadmin/tenants/:id/aprobar — aprueba o desaprueba un tenant
router.put('/tenants/:id/aprobar', async (req, res) => {
  try {
    const { aprobado } = req.body;
    if (typeof aprobado !== 'boolean') {
      return res.status(400).json({ error: 'Campo aprobado (boolean) requerido.' });
    }
    const result = await query(
      'UPDATE tenants SET aprobado = $1 WHERE id = $2 RETURNING id, nombre, aprobado',
      [aprobado, req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Tenant no encontrado.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('superadmin/aprobar:', err);
    res.status(500).json({ error: 'Error al actualizar tenant.' });
  }
});

// GET /api/superadmin/leads — lista todos los leads capturados desde la landing
router.get('/leads', async (req, res) => {
  try {
    const result = await query(
      'SELECT email, creado_en FROM leads ORDER BY creado_en DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('superadmin/leads:', err);
    res.status(500).json({ error: 'Error al obtener leads.' });
  }
});

module.exports = router;
