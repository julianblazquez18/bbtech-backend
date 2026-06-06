// src/index.js
// Servidor principal BBTECH Backend

'use strict';

require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const authRoutes      = require('./routes/auth');
const estanciasRoutes = require('./routes/estancias');
const ciclosRoutes    = require('./routes/ciclos');
const vacasRoutes     = require('./routes/vacas');
const historialRoutes = require('./routes/historial');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/estancias', estanciasRoutes);
app.use('/api/ciclos',    ciclosRoutes);
app.use('/api/vacas',     vacasRoutes);
app.use('/api/historial', historialRoutes);

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🐄 BBTECH Backend corriendo en puerto ${PORT}`);
  console.log(`   ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   DB:  ${process.env.DATABASE_URL ? '✅ configurada' : '❌ DATABASE_URL no definida'}`);
});

module.exports = app;
