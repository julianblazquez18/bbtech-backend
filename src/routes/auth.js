// src/routes/auth.js

'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { query } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos.' });
    }

    // LEFT JOIN para soportar superadmin (tenant_id = NULL)
    const result = await query(
      `SELECT u.*, t.nombre AS empresa_nombre, t.logo_url, t.aprobado
       FROM usuarios u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE LOWER(u.email) = LOWER($1)`,
      [email.trim()]
    );
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const user = result.rows[0];

    // Verificar contraseña
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    // Verificar que el tenant esté aprobado (no aplica a superadmin)
    if (user.rol !== 'superadmin' && user.aprobado === false) {
      return res.status(403).json({ error: 'Tu cuenta está pendiente de aprobación. Contactá al administrador.' });
    }

    // Generar JWT con userId + tenantId (clave para multi-tenant)
    const token = jwt.sign(
      {
        userId:        user.id,
        tenantId:      user.tenant_id,
        email:         user.email,
        nombre:        user.nombre,
        rol:           user.rol,
        empresaNombre: user.empresa_nombre || '',
        logoUrl:       user.logo_url       || '',
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id:            user.id,
        nombre:        user.nombre,
        email:         user.email,
        rol:           user.rol,
        tenantId:      user.tenant_id,
        empresaNombre: user.empresa_nombre || '',
        logoUrl:       user.logo_url       || '',
      }
    });

  } catch (err) {
    console.error('/auth/login error:', err);
    res.status(500).json({ error: 'Error del servidor.' });
  }
});

// GET /api/auth/me — verifica sesión activa
router.get('/me', authMiddleware, async (req, res) => {
  try {
    // LEFT JOIN para soportar superadmin (tenant_id = NULL)
    const result = await query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.tenant_id,
              t.nombre AS empresa_nombre, t.logo_url
       FROM usuarios u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [req.user.userId]
    );
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado.' });
    }
    const u = result.rows[0];
    res.json({
      id:            u.id,
      nombre:        u.nombre,
      email:         u.email,
      rol:           u.rol,
      tenantId:      u.tenant_id,
      empresaNombre: u.empresa_nombre || '',
      logoUrl:       u.logo_url       || '',
    });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor.' });
  }
});

// POST /api/auth/registro — solicitud de acceso de una empresa nueva
router.post('/registro', async (req, res) => {
  try {
    const { empresaNombre, emailContacto, adminNombre, adminEmail, adminPassword } = req.body;

    // Validaciones básicas
    if (!empresaNombre?.trim() || !adminNombre?.trim() || !adminEmail?.trim() || !adminPassword) {
      return res.status(400).json({ error: 'Todos los campos son requeridos.' });
    }
    if (adminPassword.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(adminEmail.trim())) {
      return res.status(400).json({ error: 'El email del administrador no es válido.' });
    }

    // Verificar que el email no esté en uso
    const emailExists = await query(
      'SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1)',
      [adminEmail.trim()]
    );
    if (emailExists.rowCount > 0) {
      return res.status(400).json({ error: 'Ese email ya está registrado en el sistema.' });
    }

    // Crear tenant con aprobado = false
    const tenantRes = await query(
      `INSERT INTO tenants (nombre, empresa_nombre, email_contacto, aprobado)
       VALUES ($1, $2, $3, false) RETURNING id`,
      [empresaNombre.trim(), empresaNombre.trim(), (emailContacto || adminEmail).trim()]
    );
    const tenantId = tenantRes.rows[0].id;

    // Crear usuario admin del tenant
    const hash = await bcrypt.hash(adminPassword, 12);
    await query(
      `INSERT INTO usuarios (tenant_id, email, password_hash, nombre, rol)
       VALUES ($1, $2, $3, $4, 'admin')`,
      [tenantId, adminEmail.trim().toLowerCase(), hash, adminNombre.trim()]
    );

    res.status(201).json({
      ok: true,
      message: 'Solicitud registrada. Te avisaremos cuando tu cuenta sea aprobada.'
    });

  } catch (err) {
    console.error('/auth/registro error:', err);
    res.status(500).json({ error: 'Error al procesar el registro.' });
  }
});

module.exports = router;
