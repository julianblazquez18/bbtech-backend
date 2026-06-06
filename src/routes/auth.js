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

    // Buscar usuario
    const result = await query(
      `SELECT u.*, t.nombre AS empresa_nombre, t.logo_url
       FROM usuarios u
       JOIN tenants t ON t.id = u.tenant_id
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
    const result = await query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.tenant_id,
              t.nombre AS empresa_nombre, t.logo_url
       FROM usuarios u
       JOIN tenants t ON t.id = u.tenant_id
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

module.exports = router;
