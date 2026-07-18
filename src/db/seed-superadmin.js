// Correr UNA SOLA VEZ con: node src/db/seed-superadmin.js
// Después de correrlo exitosamente, podés borrarlo

'use strict';
require('dotenv').config();
const bcrypt   = require('bcryptjs');
const { query } = require('./pool');

async function seed() {
  try {
    // Verificar que no existe ya
    const exists = await query(
      "SELECT id FROM usuarios WHERE email = $1",
      ['julianblazquez04@gmail.com']
    );
    if (exists.rowCount > 0) {
      console.log('⚠️  Superadmin ya existe.');
      process.exit(0);
    }

    const hash = await bcrypt.hash('#Julian09', 12);
    
    await query(
      `INSERT INTO usuarios (tenant_id, email, password_hash, nombre, rol)
       VALUES (NULL, $1, $2, 'Julian', 'superadmin')`,
      ['julianblazquez04@gmail.com', hash]
    );
    
    console.log('✅ Superadmin creado: julianblazquez04@gmail.com');
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
  process.exit(0);
}

seed();