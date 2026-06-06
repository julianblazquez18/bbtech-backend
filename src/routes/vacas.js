// src/routes/vacas.js

'use strict';

const express = require('express');
const { query, transaction } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── HELPERS ───────────────────────────────────────────────────

// Aplica auto-fill downstream al actualizar etapa
function autoFill(updates, etapa, estado) {
  if (etapa === 'entore' && estado === 'vacia') {
    updates.parto_estado  = 'no_pario';   updates.parto_locked  = true;
    updates.destete_estado= 'no_desteto'; updates.destete_locked= true;
  }
  if (etapa === 'parto' && estado === 'no_pario') {
    updates.destete_estado= 'no_desteto'; updates.destete_locked= true;
  }
  if (etapa === 'entore' && estado === 'preniada') {
    // Desbloquear parto y destete si venían bloqueados
    updates.parto_locked  = false;
    updates.destete_locked= false;
    // Solo resetear si estaban en el estado bloqueado
    updates._unlockParto  = true;
    updates._unlockDestete= true;
  }
  if (etapa === 'parto' && estado === 'pario') {
    updates.destete_locked = false;
    updates._unlockDestete = true;
  }
  return updates;
}

// POST /api/vacas — agregar una vaca a un ciclo
router.post('/', async (req, res) => {
  try {
    const { cicloId, caravana } = req.body;
    const tid = req.user.tenantId;

    if (!cicloId || !caravana?.trim()) {
      return res.status(400).json({ error: 'cicloId y caravana requeridos.' });
    }

    const car = caravana.trim().toUpperCase();
    if (!/^[A-Za-z0-9\-_]{1,20}$/.test(car)) {
      return res.status(400).json({ error: 'Caravana inválida. Solo letras, números, - o _.' });
    }

    // Verificar ciclo activo y del tenant
    const cicloRes = await query(
      'SELECT grupo_id FROM ciclos WHERE id = $1 AND tenant_id = $2 AND estado = $3',
      [cicloId, tid, 'activo']
    );
    if (cicloRes.rowCount === 0) {
      return res.status(404).json({ error: 'Ciclo no encontrado o cerrado.' });
    }

    // Verificar que no existe en NINGÚN ciclo del tenant (salvo via mover/traspasar)
    const dupRes = await query(
      'SELECT v.caravana, c.nombre AS ciclo FROM vacas v JOIN ciclos c ON v.ciclo_id = c.id WHERE v.tenant_id = $1 AND v.caravana = $2',
      [tid, car]
    );
    if (dupRes.rowCount > 0) {
      const cicloDup = dupRes.rows[0].ciclo;
      return res.status(400).json({
        error: `Caravana "${car}" ya existe en la safra "${cicloDup}". Para moverla usá Traspasar o Mover.`
      });
    }

    const grupoId = cicloRes.rows[0].grupo_id;
    const result = await query(
      `INSERT INTO vacas (tenant_id, ciclo_id, caravana, grupo_origen_id, grupo_actual_id)
       VALUES ($1, $2, $3, $4, $4) RETURNING *`,
      [tid, cicloId, car, grupoId]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al agregar vaca.' });
  }
});

// POST /api/vacas/bulk — agregar varias vacas
router.post('/bulk', async (req, res) => {
  try {
    const { cicloId, caravanas } = req.body;
    const tid = req.user.tenantId;

    if (!cicloId || !Array.isArray(caravanas) || caravanas.length === 0) {
      return res.status(400).json({ error: 'cicloId y caravanas[] requeridos.' });
    }

    const cicloRes = await query(
      'SELECT grupo_id FROM ciclos WHERE id = $1 AND tenant_id = $2 AND estado = $3',
      [cicloId, tid, 'activo']
    );
    if (cicloRes.rowCount === 0) {
      return res.status(404).json({ error: 'Ciclo no encontrado o cerrado.' });
    }
    const grupoId = cicloRes.rows[0].grupo_id;

    const resultados = { ok: [], error: [] };

    await transaction(async (client) => {
      for (const raw of caravanas) {
        const car = String(raw).trim().toUpperCase();
        if (!/^[A-Za-z0-9\-_]{1,20}$/.test(car)) {
          resultados.error.push({ caravana: car, motivo: 'ID inválido' });
          continue;
        }
        // Check duplicado global
        const dup = await client.query(
          'SELECT id FROM vacas WHERE tenant_id = $1 AND caravana = $2',
          [tid, car]
        );
        if (dup.rowCount > 0) {
          resultados.error.push({ caravana: car, motivo: 'Ya existe en el sistema' });
          continue;
        }
        await client.query(
          `INSERT INTO vacas (tenant_id, ciclo_id, caravana, grupo_origen_id, grupo_actual_id)
           VALUES ($1,$2,$3,$4,$4)`,
          [tid, cicloId, car, grupoId]
        );
        resultados.ok.push(car);
      }
    });

    res.json({ ok: resultados.ok.length, errors: resultados.error });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al agregar vacas.' });
  }
});

// PUT /api/vacas/:id/etapa — actualizar entore/parto/destete
router.put('/:id/etapa', async (req, res) => {
  try {
    const { etapa, estado, fecha, obs } = req.body;
    const tid = req.user.tenantId;

    if (!['entore','parto','destete'].includes(etapa)) {
      return res.status(400).json({ error: 'Etapa inválida.' });
    }

    // Verificar ownership y obtener estado actual
    const vacaRes = await query(
      'SELECT * FROM vacas WHERE id = $1 AND tenant_id = $2',
      [req.params.id, tid]
    );
    if (vacaRes.rowCount === 0) return res.status(404).json({ error: 'Vaca no encontrada.' });
    const vaca = vacaRes.rows[0];

    // Verificar bloqueos
    if (etapa === 'parto'   && vaca.entore_estado === 'vacia')   return res.status(400).json({ error: 'Parto bloqueado: entore es Vacía.' });
    if (etapa === 'destete' && vaca.entore_estado === 'vacia')   return res.status(400).json({ error: 'Destete bloqueado: entore es Vacía.' });
    if (etapa === 'destete' && vaca.parto_estado  === 'no_pario') return res.status(400).json({ error: 'Destete bloqueado: No parió.' });

    // Construir objeto de campos a actualizar — usando objeto para evitar duplicados
    const updates = {};

    // Campo principal
    updates[`${etapa}_estado`] = estado;
    if (fecha !== undefined) updates[`${etapa}_fecha`] = fecha || null;
    if (obs   !== undefined) updates[`${etapa}_obs`]   = obs   || '';

    // Auto-fill downstream según la lógica de negocio
    if (etapa === 'entore') {
      if (estado === 'vacia') {
        // Vacía → bloquear parto y destete
        updates.parto_estado   = 'no_pario';
        updates.parto_locked   = true;
        updates.destete_estado = 'no_desteto';
        updates.destete_locked = true;
      } else if (estado === 'preniada') {
        // Preniada → desbloquear parto/destete si estaban bloqueados
        if (vaca.parto_locked) {
          updates.parto_estado = 'pendiente';
          updates.parto_locked = false;
        }
        if (vaca.destete_locked) {
          updates.destete_estado = 'pendiente';
          updates.destete_locked = false;
        }
      }
    }

    if (etapa === 'parto') {
      if (estado === 'no_pario') {
        // No parió → bloquear destete
        updates.destete_estado = 'no_desteto';
        updates.destete_locked = true;
      } else if (estado === 'pario' && vaca.destete_locked) {
        // Parió → desbloquear destete
        updates.destete_estado = 'pendiente';
        updates.destete_locked = false;
      }
    }

    // Convertir objeto a SET de SQL — sin duplicados posibles
    const keys   = Object.keys(updates);
    const values = Object.values(updates);
    const setCols = keys.map((k, i) => `${k} = $${i + 1}`);
    values.push(req.params.id, tid);

    const result = await query(
      `UPDATE vacas SET ${setCols.join(', ')} WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('etapa error:', err);
    res.status(500).json({ error: 'Error al actualizar etapa.' });
  }
});

// PUT /api/vacas/:id/descarte — marcar/actualizar descarte
router.put('/:id/descarte', async (req, res) => {
  try {
    const { obs, estado } = req.body;
    const tid = req.user.tenantId;

    const result = await query(
      `UPDATE vacas
       SET descarte = TRUE,
           descarte_obs    = COALESCE($1, descarte_obs),
           descarte_estado = COALESCE($2, descarte_estado),
           descarte_fecha  = CURRENT_DATE
       WHERE id = $3 AND tenant_id = $4
       RETURNING *`,
      [obs ?? null, estado ?? 'pendiente', req.params.id, tid]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Vaca no encontrada.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al marcar descarte.' });
  }
});

// PUT /api/vacas/:id/obs — actualizar observación general
router.put('/:id/obs', async (req, res) => {
  try {
    const { obs } = req.body;
    const result = await query(
      'UPDATE vacas SET obs = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *',
      [obs || '', req.params.id, req.user.tenantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Vaca no encontrada.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar observación.' });
  }
});

// POST /api/vacas/mover — mover vacas entre ciclos con toda su info
router.post('/mover', async (req, res) => {
  try {
    const { deCicloId, vacaIds, aCicloId } = req.body;
    const tid = req.user.tenantId;

    const destRes = await query(
      'SELECT grupo_id FROM ciclos WHERE id = $1 AND tenant_id = $2 AND estado != $3',
      [aCicloId, tid, 'cerrado']
    );
    if (destRes.rowCount === 0) return res.status(404).json({ error: 'Ciclo destino no encontrado.' });
    const destGrupoId = destRes.rows[0].grupo_id;

    const vacasRes = await query(
      'SELECT * FROM vacas WHERE id = ANY($1) AND ciclo_id = $2 AND tenant_id = $3',
      [vacaIds, deCicloId, tid]
    );

    let movidas = 0;
    await transaction(async (client) => {
      for (const v of vacasRes.rows) {
        // Actualizar ciclo y grupo actual (mantiene todos los datos)
        await client.query(
          'UPDATE vacas SET ciclo_id = $1, grupo_actual_id = $2 WHERE id = $3',
          [aCicloId, destGrupoId, v.id]
        );
        // Registrar movimiento
        await client.query(
          `INSERT INTO movimientos
             (tenant_id, vaca_id, de_ciclo_id, a_ciclo_id, de_grupo_id, a_grupo_id, tipo)
           VALUES ($1,$2,$3,$4,$5,$6,'mover')`,
          [tid, v.id, deCicloId, aCicloId, v.grupo_actual_id, destGrupoId]
        );
        movidas++;
      }
    });

    res.json({ ok: true, count: movidas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al mover vacas.' });
  }
});

// DELETE /api/vacas — eliminar vacas (array de IDs)
router.delete('/', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids[] requerido.' });
    }
    const result = await query(
      'DELETE FROM vacas WHERE id = ANY($1) AND tenant_id = $2',
      [ids, req.user.tenantId]
    );
    res.json({ ok: true, deleted: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar vacas.' });
  }
});

module.exports = router;
