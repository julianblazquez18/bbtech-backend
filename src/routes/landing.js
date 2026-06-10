// src/routes/landing.js
// Endpoint público para captura de leads desde la landing page

'use strict';

const express = require('express');
const { query } = require('../db/pool');

const router = express.Router();

// POST /api/landing/email — registrar email de interesado
router.post('/email', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email inválido.' });
  }
  try {
    await query(
      'INSERT INTO leads (email) VALUES ($1)',
      [email.trim().toLowerCase()]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') { // unique violation
      return res.status(409).json({ error: 'Ya registrado.' });
    }
    console.error('landing/email:', err);
    res.status(500).json({ error: 'Error del servidor.' });
  }
});

module.exports = router;
