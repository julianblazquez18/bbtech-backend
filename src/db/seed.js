// src/db/seed.js
// Crea el primer usuario admin para la familia
// Ejecutar una sola vez: npm run seed

'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query } = require('./pool');

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ADMIN_EMAIL    = 'admin@bbtech.com';
const ADMIN_PASSWORD = 'bbtech2024';   // Cambiar en producción
const ADMIN_NOMBRE   = 'Administrador';

async function seed() {
  console.log('🌱 Iniciando seed...');

  try {
    // Verificar que el tenant existe
    const tenantRes = await query('SELECT id FROM tenants WHERE id = $1', [TENANT_ID]);
    if (tenantRes.rowCount === 0) {
      console.error('❌ Tenant no encontrado. Ejecutar schema.sql primero.');
      process.exit(1);
    }

    // Verificar si el usuario ya existe
    const existsRes = await query('SELECT id FROM usuarios WHERE email = $1', [ADMIN_EMAIL]);
    if (existsRes.rowCount > 0) {
      console.log('⚠️  Usuario admin ya existe. No se creó uno nuevo.');
      process.exit(0);
    }

    // Hash de la contraseña
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    // Insertar usuario admin
    await query(
      `INSERT INTO usuarios (tenant_id, email, password_hash, nombre, rol)
       VALUES ($1, $2, $3, $4, 'admin')`,
      [TENANT_ID, ADMIN_EMAIL, hash, ADMIN_NOMBRE]
    );

    console.log('✅ Usuario admin creado:');
    console.log(`   Email:    ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    console.log('   ⚠️  Cambiar la contraseña en producción.');

  } catch (err) {
    console.error('❌ Error en seed:', err.message);
    process.exit(1);
  }

  process.exit(0);
}

seed();
