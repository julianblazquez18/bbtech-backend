// src/routes/usuarios.js
// Gestión de usuarios dentro de un tenant — solo admin

'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const { query } = require('../db/pool');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(requireAdmin);

// GET /api/usuarios — lista usuarios del tenant
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, nombre, email, rol, creado_en
       FROM usuarios
       WHERE tenant_id = $1
       ORDER BY creado_en ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /usuarios:', err);
    res.status(500).json({ error: 'Error al obtener usuarios.' });
  }
});

// POST /api/usuarios — crear usuario en el tenant
router.post('/', async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    const tid = req.user.tenantId;

    if (!nombre?.trim() || !email?.trim() || !password || !rol) {
      return res.status(400).json({ error: 'Nombre, email, contraseña y rol son requeridos.' });
    }
    if (!['admin', 'usuario'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    }

    // Email único global
    const dup = await query(
      'SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );
    if (dup.rowCount > 0) {
      return res.status(400).json({ error: 'Ese email ya está registrado.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO usuarios (tenant_id, email, password_hash, nombre, rol)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, email, rol, creado_en`,
      [tid, email.trim().toLowerCase(), hash, nombre.trim(), rol]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /usuarios:', err);
    res.status(500).json({ error: 'Error al crear usuario.' });
  }
});

// PUT /api/usuarios/:id — editar nombre, rol y/o contraseña
router.put('/:id', async (req, res) => {
  try {
    const { nombre, rol, password } = req.body;
    const tid = req.user.tenantId;

    // Verificar que el usuario pertenece al tenant
    const existing = await query(
      'SELECT id, rol FROM usuarios WHERE id = $1 AND tenant_id = $2',
      [req.params.id, tid]
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    if (rol && !['admin', 'usuario'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido.' });
    }

    // Si se baja el rol de admin → verificar que no sea el único
    if (rol === 'usuario' && existing.rows[0].rol === 'admin') {
      const adminCount = await query(
        "SELECT COUNT(*) FROM usuarios WHERE tenant_id = $1 AND rol = 'admin'",
        [tid]
      );
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return res.status(400).json({ error: 'No podés quitar el rol al único administrador.' });
      }
    }

    // Construir SET dinámico
    const sets = [];
    const vals = [];
    if (nombre?.trim()) { sets.push(`nombre = $${vals.length + 1}`); vals.push(nombre.trim()); }
    if (rol)            { sets.push(`rol = $${vals.length + 1}`);    vals.push(rol); }
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Contraseña mínimo 8 caracteres.' });
      const hash = await bcrypt.hash(password, 12);
      sets.push(`password_hash = $${vals.length + 1}`);
      vals.push(hash);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Nada que actualizar.' });
    }

    vals.push(req.params.id, tid);
    const result = await query(
      `UPDATE usuarios SET ${sets.join(', ')}
       WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length}
       RETURNING id, nombre, email, rol, creado_en`,
      vals
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /usuarios/:id:', err);
    res.status(500).json({ error: 'Error al editar usuario.' });
  }
});

// DELETE /api/usuarios/:id — eliminar usuario
router.delete('/:id', async (req, res) => {
  try {
    const tid = req.user.tenantId;

    // No puede eliminarse a sí mismo
    if (req.params.id === req.user.userId) {
      return res.status(400).json({ error: 'No podés eliminar tu propio usuario.' });
    }

    const existing = await query(
      'SELECT rol FROM usuarios WHERE id = $1 AND tenant_id = $2',
      [req.params.id, tid]
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    // Si es admin, verificar que no sea el único
    if (existing.rows[0].rol === 'admin') {
      const adminCount = await query(
        "SELECT COUNT(*) FROM usuarios WHERE tenant_id = $1 AND rol = 'admin'",
        [tid]
      );
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return res.status(400).json({ error: 'No podés eliminar el único administrador.' });
      }
    }

    await query(
      'DELETE FROM usuarios WHERE id = $1 AND tenant_id = $2',
      [req.params.id, tid]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /usuarios/:id:', err);
    res.status(500).json({ error: 'Error al eliminar usuario.' });
  }
});

module.exports = router;
