# BBTECH Backend

API REST para el sistema de control bovino BBTECH.  
Node.js + Express + PostgreSQL (Neon) — Multi-tenant listo desde el día uno.

---

## Estructura del proyecto

```
bbtech-backend/
├── src/
│   ├── index.js              ← Servidor Express principal
│   ├── db/
│   │   ├── pool.js           ← Conexión a PostgreSQL (Neon)
│   │   └── seed.js           ← Crea el primer usuario admin
│   ├── middleware/
│   │   └── auth.js           ← Verifica JWT en cada request
│   └── routes/
│       ├── auth.js           ← POST /login, GET /me
│       ├── estancias.js      ← Campos, grupos y lotes
│       ├── ciclos.js         ← Safras (crear, editar, finalizar, traspasar)
│       ├── vacas.js          ← Animales (CRUD, etapas, descarte, mover)
│       └── historial.js      ← Ciclos cerrados
├── sql/
│   └── schema.sql            ← Schema completo para Neon
├── .env.example              ← Variables de entorno
├── .gitignore
└── package.json
```

---

## Setup inicial

### 1. Clonar y instalar dependencias
```bash
git clone <tu-repo>
cd bbtech-backend
npm install
```

### 2. Configurar variables de entorno
```bash
cp .env.example .env
# Editar .env con tus valores reales
```

### 3. Crear la base de datos en Neon
1. Ir a [console.neon.tech](https://console.neon.tech)
2. Crear proyecto → Database: `bbtech`
3. Ir a SQL Editor
4. Copiar y ejecutar el contenido de `sql/schema.sql`

### 4. Crear el primer usuario admin
```bash
npm run seed
```

### 5. Correr en desarrollo
```bash
npm run dev
```

---

## Deploy en Render

1. Subir este repo a GitHub
2. En [render.com](https://render.com) → New Web Service
3. Conectar el repo
4. Configurar:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Plan:** Starter ($7/mes) — necesario para que no duerma
5. Agregar variables de entorno en Render:
   - `DATABASE_URL` — connection string de Neon
   - `JWT_SECRET` — string aleatorio largo
   - `FRONTEND_URL` — URL de Vercel una vez deployado
   - `NODE_ENV` — `production`

---

## API Endpoints

### Auth
```
POST /api/auth/login     { email, password }  → { token, user }
GET  /api/auth/me        (requiere Bearer token)
```

### Estancias
```
GET    /api/estancias                    → campos con grupos anidados
POST   /api/estancias                    { nombre }
PUT    /api/estancias/:id                { nombre }
DELETE /api/estancias/:id
POST   /api/estancias/:id/grupos         { nombre, tipo }
PUT    /api/estancias/:id/grupos/:gId    { nombre }
DELETE /api/estancias/:id/grupos/:gId
GET    /api/estancias/lotes/list
POST   /api/estancias/lotes              { nombre }
PUT    /api/estancias/lotes/:id          { nombre }
DELETE /api/estancias/lotes/:id
```

### Ciclos
```
GET    /api/ciclos?grupoId=xxx
GET    /api/ciclos/:id                   → ciclo + vacas + stats
POST   /api/ciclos                       { grupoId, nombre, fechaInicio }
PUT    /api/ciclos/:id                   { nombre?, fechaInicio?, lote?, obs? }
DELETE /api/ciclos/:id
POST   /api/ciclos/:id/finalizar         → valida, cierra y guarda historial
POST   /api/ciclos/:id/traspasar         { aCicloId, caravanas? }
```

### Vacas
```
POST   /api/vacas                        { cicloId, caravana }
POST   /api/vacas/bulk                   { cicloId, caravanas[] }
PUT    /api/vacas/:id/etapa              { etapa, estado, fecha?, obs? }
PUT    /api/vacas/:id/descarte           { obs?, estado? }
PUT    /api/vacas/:id/obs                { obs }
POST   /api/vacas/mover                  { deCicloId, vacaIds[], aCicloId }
DELETE /api/vacas                        { ids[] }
```

### Historial
```
GET    /api/historial
GET    /api/historial/:id
```

---

## Multi-tenancy

Cada request autenticado incluye `tenantId` en el JWT.  
Todos los endpoints filtran por `tenant_id = req.user.tenantId`.  
Un usuario nunca puede ver ni modificar datos de otro tenant.

Para agregar un nuevo cliente (Opción C futura):
1. `INSERT INTO tenants (nombre) VALUES ('Nueva Empresa');`
2. `npm run seed` (modificar el script con los datos del nuevo cliente)
3. Opcionalmente: construir pantalla de registro automático
