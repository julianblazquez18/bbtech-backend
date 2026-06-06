// src/routes/estancias.js
// Campos, grupos y lotes — siempre filtrado por tenant_id

'use strict';

const express = require('express');
const { query, transaction } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);  // todas las rutas requieren auth

// ── ESTANCIAS ─────────────────────────────────────────────────

// GET /api/estancias — lista campos con sus grupos
router.get('/', async (req, res) => {
  try {
    const tid = req.user.tenantId;

    const estRes = await query(
      'SELECT * FROM estancias WHERE tenant_id = $1 ORDER BY orden, nombre',
      [tid]
    );
    const grpRes = await query(
      'SELECT * FROM grupos WHERE tenant_id = $1 ORDER BY orden, nombre',
      [tid]
    );

    // Armar estructura anidada campo → grupos
    const estancias = estRes.rows.map(e => ({
      ...e,
      rodeos: grpRes.rows.filter(g => g.estancia_id === e.id)
    }));

    res.json(estancias);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener estancias.' });
  }
});

// POST /api/estancias — crear campo
router.post('/', async (req, res) => {
  try {
    const { nombre, icon = '🌾' } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });

    const result = await query(
      'INSERT INTO estancias (tenant_id, nombre, icon) VALUES ($1, $2, $3) RETURNING *',
      [req.user.tenantId, nombre.trim(), icon]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear campo.' });
  }
});

// PUT /api/estancias/:id — editar campo
router.put('/:id', async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });

    const result = await query(
      'UPDATE estancias SET nombre = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *',
      [nombre.trim(), req.params.id, req.user.tenantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Campo no encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al editar campo.' });
  }
});

// DELETE /api/estancias/:id — eliminar campo
router.delete('/:id', async (req, res) => {
  try {
    // ON DELETE CASCADE elimina grupos, ciclos y vacas automáticamente
    const result = await query(
      'DELETE FROM estancias WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Campo no encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar campo.' });
  }
});

// ── GRUPOS ────────────────────────────────────────────────────

// POST /api/estancias/:estanciaId/grupos — crear grupo
router.post('/:estanciaId/grupos', async (req, res) => {
  try {
    const { nombre, tipo = 'rodeo' } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });

    // Verificar que la estancia pertenece al tenant
    const estRes = await query(
      'SELECT id FROM estancias WHERE id = $1 AND tenant_id = $2',
      [req.params.estanciaId, req.user.tenantId]
    );
    if (estRes.rowCount === 0) return res.status(404).json({ error: 'Campo no encontrado.' });

    const result = await query(
      'INSERT INTO grupos (tenant_id, estancia_id, nombre, tipo) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.tenantId, req.params.estanciaId, nombre.trim(), tipo]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear grupo.' });
  }
});

// PUT /api/estancias/:estanciaId/grupos/:id — editar grupo
router.put('/:estanciaId/grupos/:id', async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });

    const result = await query(
      'UPDATE grupos SET nombre = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *',
      [nombre.trim(), req.params.id, req.user.tenantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al editar grupo.' });
  }
});

// DELETE /api/estancias/:estanciaId/grupos/:id — eliminar grupo
router.delete('/:estanciaId/grupos/:id', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM grupos WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar grupo.' });
  }
});

// ── LOTES ─────────────────────────────────────────────────────

// GET /api/estancias/lotes — listar lotes
router.get('/lotes/list', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM lotes WHERE tenant_id = $1 ORDER BY orden, nombre',
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener lotes.' });
  }
});

// POST /api/estancias/lotes — crear lote
router.post('/lotes', async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });

    const exists = await query(
      'SELECT id FROM lotes WHERE tenant_id = $1 AND LOWER(nombre) = LOWER($2)',
      [req.user.tenantId, nombre.trim()]
    );
    if (exists.rowCount > 0) return res.status(400).json({ error: 'Ya existe ese lote.' });

    const result = await query(
      'INSERT INTO lotes (tenant_id, nombre) VALUES ($1, $2) RETURNING *',
      [req.user.tenantId, nombre.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear lote.' });
  }
});

// PUT /api/estancias/lotes/:id — renombrar lote
router.put('/lotes/:id', async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });

    const result = await query(
      'UPDATE lotes SET nombre = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *',
      [nombre.trim(), req.params.id, req.user.tenantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Lote no encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al editar lote.' });
  }
});

// DELETE /api/estancias/lotes/:id — eliminar lote
router.delete('/lotes/:id', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM lotes WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Lote no encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar lote.' });
  }
});

module.exports = router;
