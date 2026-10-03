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
         t.id, t.nombre, t.empresa_nombre,
         t.email_contacto, t.aprobado,
         t.suspendido, t.modulos,
         t.plan, t.creado_en,
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

// PUT /api/superadmin/tenants/:id/modulos — actualiza módulos habilitados del tenant
router.put('/tenants/:id/modulos', async (req, res) => {
  try {
    const { modulos } = req.body;
    const MODULOS_VALIDOS = ['ganadero', 'agro', 'empleados', 'serv'];
    if (modulos !== null && modulos !== undefined) {
      if (!Array.isArray(modulos)) {
        return res.status(400).json({ error: 'modulos debe ser un array o null.' });
      }
      const invalidos = modulos.filter(m => !MODULOS_VALIDOS.includes(m));
      if (invalidos.length > 0) {
        return res.status(400).json({ error: `Módulos inválidos: ${invalidos.join(', ')}` });
      }
    }
    const result = await query(
      'UPDATE tenants SET modulos = $1 WHERE id = $2 RETURNING id, nombre, modulos',
      [modulos || null, req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Tenant no encontrado.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('superadmin/tenants/modulos:', err);
    res.status(500).json({ error: 'Error al actualizar módulos.' });
  }
});

// PUT /api/superadmin/tenants/:id/suspender — suspende o reactiva un tenant
router.put('/tenants/:id/suspender', async (req, res) => {
  try {
    const { suspendido } = req.body;
    if (typeof suspendido !== 'boolean') {
      return res.status(400).json({ error: 'Campo suspendido (boolean) requerido.' });
    }
    const result = await query(
      'UPDATE tenants SET suspendido = $1 WHERE id = $2 RETURNING id, nombre, suspendido',
      [suspendido, req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Tenant no encontrado.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('superadmin/tenants/suspender:', err);
    res.status(500).json({ error: 'Error al suspender tenant.' });
  }
});

// PUT /api/superadmin/usuarios/:id/suspender — suspende o reactiva un usuario
router.put('/usuarios/:id/suspender', async (req, res) => {
  try {
    const { suspendido } = req.body;
    if (typeof suspendido !== 'boolean') {
      return res.status(400).json({ error: 'Campo suspendido (boolean) requerido.' });
    }
    // Solo usuarios con tenant (no superadmins)
    const check = await query(
      'SELECT id FROM usuarios WHERE id = $1 AND tenant_id IS NOT NULL',
      [req.params.id]
    );
    if (check.rowCount === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    const result = await query(
      'UPDATE usuarios SET suspendido = $1 WHERE id = $2 RETURNING id, nombre, email, suspendido',
      [suspendido, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('superadmin/usuarios/suspender:', err);
    res.status(500).json({ error: 'Error al suspender usuario.' });
  }
});

// PUT /api/superadmin/usuarios/:id/modulos — actualiza módulos de un usuario (null = heredar del tenant)
router.put('/usuarios/:id/modulos', async (req, res) => {
  try {
    const { modulos } = req.body;
    const MODULOS_VALIDOS = ['ganadero', 'agro', 'empleados', 'serv'];
    const modulosFinal = modulos === null
      ? null
      : (modulos || []).filter(m => MODULOS_VALIDOS.includes(m));
    const uRes = await query(
      'SELECT tenant_id FROM usuarios WHERE id = $1',
      [req.params.id]
    );
    if (!uRes.rowCount || !uRes.rows[0].tenant_id) {
      return res.status(400).json({ error: 'No se puede modificar este usuario.' });
    }
    await query(
      'UPDATE usuarios SET modulos = $1 WHERE id = $2',
      [modulosFinal, req.params.id]
    );
    res.json({ ok: true, modulos: modulosFinal });
  } catch (err) {
    console.error('superadmin/usuarios/modulos:', err);
    res.status(500).json({ error: 'Error.' });
  }
});

// GET /api/superadmin/tenants/:id/usuarios — lista usuarios de un tenant
router.get('/tenants/:id/usuarios', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, nombre, email, rol, modulos, suspendido, creado_en
       FROM usuarios
       WHERE tenant_id = $1
       ORDER BY creado_en ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('superadmin/tenants/usuarios:', err);
    res.status(500).json({ error: 'Error al obtener usuarios.' });
  }
});

module.exports = router;
