// src/middleware/auth.js
// Verifica el JWT en cada request y adjunta usuario + tenantId al req

'use strict';

const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido.' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // payload contiene: userId, tenantId, email, nombre, rol
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

// Middleware para verificar rol admin
function requireAdmin(req, res, next) {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Se requiere rol administrador.' });
  }
  next();
}

module.exports = { authMiddleware, requireAdmin };
