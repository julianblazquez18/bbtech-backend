// src/routes/empleados.js
// CRUD de empleados, tipos de asistencia y registro de asistencias

'use strict';

const express = require('express');
const router  = express.Router();
const { query, transaction } = require('../db/pool');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

router.use(authMiddleware);

// ── EMPLEADOS ────────────────────────────────────────────────────

// GET /api/empleados
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM empleados
       WHERE tenant_id = $1
       ORDER BY activo DESC, apellido, nombre`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener empleados.' });
  }
});

// POST /api/empleados (solo admin)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { nombre, apellido, rol, telefono, fecha_nacimiento } = req.body;
    if (!nombre?.trim() || !apellido?.trim()) {
      return res.status(400).json({ error: 'Nombre y apellido requeridos.' });
    }
    const result = await query(
      `INSERT INTO empleados
         (tenant_id, nombre, apellido, rol, telefono, fecha_nacimiento)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.tenantId, nombre.trim(), apellido.trim(),
       rol || '', telefono || '', fecha_nacimiento || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear empleado.' });
  }
});

// PUT /api/empleados/:id (solo admin)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre, apellido, rol, telefono, fecha_nacimiento, activo } = req.body;
    const result = await query(
      `UPDATE empleados SET
         nombre           = COALESCE($1, nombre),
         apellido         = COALESCE($2, apellido),
         rol              = COALESCE($3, rol),
         telefono         = COALESCE($4, telefono),
         fecha_nacimiento = COALESCE($5, fecha_nacimiento),
         activo           = COALESCE($6, activo)
       WHERE id = $7 AND tenant_id = $8
       RETURNING *`,
      [nombre || null, apellido || null, rol || null, telefono || null,
       fecha_nacimiento || null, activo ?? null,
       req.params.id, req.user.tenantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Empleado no encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar empleado.' });
  }
});

// DELETE /api/empleados/:id — desactiva (no borra) para conservar historial
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `UPDATE empleados SET activo = FALSE
       WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, req.user.tenantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Empleado no encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al desactivar empleado.' });
  }
});

// ── TIPOS DE ASISTENCIA ──────────────────────────────────────────

const TIPOS_DEFAULT = [
  { nombre: 'Asistió',    color: '#22c55e', icono: '✓',  orden: 0 },
  { nombre: 'Faltó',      color: '#ef4444', icono: '✗',  orden: 1 },
  { nombre: 'Enfermedad', color: '#f59e0b', icono: '🏥', orden: 2 },
  { nombre: 'Vacaciones', color: '#3b82f6', icono: '🌴', orden: 3 },
  { nombre: 'Licencia',   color: '#f97316', icono: '📋', orden: 4 },
  { nombre: 'Franco',     color: '#6b7280', icono: '🔄', orden: 5 },
];

// GET /api/empleados/tipos
router.get('/tipos', async (req, res) => {
  try {
    const tid = req.user.tenantId;
    let result = await query(
      `SELECT * FROM tipos_asistencia WHERE tenant_id = $1 ORDER BY orden, nombre`,
      [tid]
    );
    if (result.rowCount === 0) {
      for (const d of TIPOS_DEFAULT) {
        await query(
          `INSERT INTO tipos_asistencia (tenant_id, nombre, color, icono, orden)
           VALUES ($1,$2,$3,$4,$5)`,
          [tid, d.nombre, d.color, d.icono, d.orden]
        );
      }
      result = await query(
        `SELECT * FROM tipos_asistencia WHERE tenant_id = $1 ORDER BY orden`,
        [tid]
      );
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener tipos.' });
  }
});

// POST /api/empleados/tipos (solo admin)
router.post('/tipos', requireAdmin, async (req, res) => {
  try {
    const { nombre, color, icono, orden, categoria, valor } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });
    const result = await query(
      `INSERT INTO tipos_asistencia (tenant_id, nombre, color, icono, orden, categoria, valor)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.tenantId, nombre.trim(), color || '#6b7280',
       icono || '•', orden || 0, categoria || 'presencia', valor ?? 1]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear tipo.' });
  }
});

// PUT /api/empleados/tipos/:id (solo admin)
router.put('/tipos/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre, color, icono, orden, categoria, valor } = req.body;
    const result = await query(
      `UPDATE tipos_asistencia SET
         nombre    = COALESCE($1, nombre),
         color     = COALESCE($2, color),
         icono     = COALESCE($3, icono),
         orden     = COALESCE($4, orden),
         categoria = COALESCE($5, categoria),
         valor     = COALESCE($6, valor)
       WHERE id = $7 AND tenant_id = $8 RETURNING *`,
      [nombre || null, color || null, icono || null, orden ?? null,
       categoria || null, valor ?? null, req.params.id, req.user.tenantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Tipo no encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar tipo.' });
  }
});

// DELETE /api/empleados/tipos/:id (solo admin)
router.delete('/tipos/:id', requireAdmin, async (req, res) => {
  try {
    const used = await query(
      `SELECT COUNT(*) FROM asistencias WHERE tipo_id = $1 AND tenant_id = $2`,
      [req.params.id, req.user.tenantId]
    );
    if (parseInt(used.rows[0].count) > 0) {
      return res.status(400).json({
        error: 'No se puede eliminar — hay asistencias registradas con este tipo.'
      });
    }
    await query(
      `DELETE FROM tipos_asistencia WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.user.tenantId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar tipo.' });
  }
});

// ── ASISTENCIAS ──────────────────────────────────────────────────

// GET /api/empleados/asistencias?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
router.get('/asistencias', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ error: 'Parámetros desde y hasta requeridos.' });
    }
    const result = await query(
      `SELECT a.*,
              TO_CHAR(a.fecha, 'YYYY-MM-DD') AS fecha,
              e.nombre   AS empleado_nombre,
              e.apellido AS empleado_apellido,
              t.nombre   AS tipo_nombre,
              t.color    AS tipo_color,
              t.icono    AS tipo_icono
       FROM asistencias a
       JOIN empleados e        ON e.id = a.empleado_id
       JOIN tipos_asistencia t ON t.id = a.tipo_id
       WHERE a.tenant_id = $1
         AND a.fecha BETWEEN $2 AND $3
       ORDER BY a.fecha, e.apellido, e.nombre`,
      [req.user.tenantId, desde, hasta]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener asistencias.' });
  }
});

// POST /api/empleados/asistencias/bulk — upsert de varios registros
router.post('/asistencias/bulk', async (req, res) => {
  try {
    const { registros } = req.body;
    if (!Array.isArray(registros) || !registros.length) {
      return res.status(400).json({ error: 'registros requerido.' });
    }
    await transaction(async (client) => {
      for (const r of registros) {
        await client.query(
          `INSERT INTO asistencias (tenant_id, empleado_id, tipo_id, fecha, obs)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (empleado_id, fecha)
           DO UPDATE SET tipo_id = $3, obs = $5`,
          [req.user.tenantId, r.empleado_id, r.tipo_id, r.fecha, r.obs || '']
        );
      }
    });
    res.json({ ok: true, count: registros.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar asistencias.' });
  }
});

// POST /api/empleados/asistencias — upsert de una asistencia
router.post('/asistencias', async (req, res) => {
  try {
    const { empleado_id, tipo_id, fecha, obs } = req.body;
    if (!empleado_id || !tipo_id || !fecha) {
      return res.status(400).json({ error: 'empleado_id, tipo_id y fecha requeridos.' });
    }
    const result = await query(
      `INSERT INTO asistencias (tenant_id, empleado_id, tipo_id, fecha, obs)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (empleado_id, fecha)
       DO UPDATE SET tipo_id = $3, obs = $5
       RETURNING *`,
      [req.user.tenantId, empleado_id, tipo_id, fecha, obs || '']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar asistencia.' });
  }
});

// DELETE /api/empleados/asistencias/:id — elimina el registro (queda sin asistencia)
router.delete('/asistencias/:id', async (req, res) => {
  try {
    await query(
      `DELETE FROM asistencias WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.user.tenantId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al borrar asistencia.' });
  }
});

// ── HISTORIAL ────────────────────────────────────────────────────

// GET /api/empleados/historial
router.get('/historial', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM historial_asistencias
       WHERE tenant_id = $1
       ORDER BY tipo DESC, periodo DESC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener historial.' });
  }
});

// POST /api/empleados/historial
router.post('/historial', requireAdmin, async (req, res) => {
  try {
    const { tipo, periodo, titulo, fecha_desde, fecha_hasta, stats } = req.body;
    const result = await query(
      `INSERT INTO historial_asistencias
         (tenant_id, tipo, periodo, titulo, fecha_desde, fecha_hasta, stats)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, tipo, periodo)
       DO UPDATE SET stats=$7, titulo=$4,
         fecha_desde=$5, fecha_hasta=$6
       RETURNING *`,
      [req.user.tenantId, tipo, periodo, titulo,
       fecha_desde, fecha_hasta, JSON.stringify(stats)]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar historial.' });
  }
});

module.exports = router;
