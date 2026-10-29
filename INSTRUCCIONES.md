# Dashboard de Tamales — Supabase + Frontend Web

Sistema de gestión para venta de tamales con base de datos en **Supabase** y autenticación de usuarios.

## Estructura del Proyecto

```
tamales-dashboard/
├── frontend/
│   ├── index.html                 ← Página principal
│   └── src/
│       ├── css/
│       │   ├── styles.css         ← Estilos globales del panel
│       │   ├── site-auth.css      ← Estilos del login
│       │   └── modules/           ← Módulos CSS
│       └── js/
│           ├── supabase-config.js ← Configuración de URL y Anon Key
│           ├── site-auth.js       ← Manejo de sesión y login
│           ├── api.js             ← Consultas y escrituras en Supabase
│           ├── app.js             ← Estado general y navegación
│           ├── pedidos.js         ← Comandas, cobro y edición
│           ├── inventario.js      ← Control de stock semanal
│           ├── ganancias.js       ← Métricas, cierres e histórico
│           └── configuracion.js   ← Tipos de tamal y precios
└── supabase/
    └── tamales.sql                ← Script SQL con tablas, índices y RLS
```

## Configuración y Despliegue

### 1. Base de datos (Supabase)
1. Entra a tu proyecto en [Supabase](https://supabase.com).
2. Ve al **SQL Editor** ➔ **New query**.
3. Pega y ejecuta el contenido de `supabase/tamales.sql`.

### 2. Configurar frontend
En `frontend/src/js/supabase-config.js`, coloca tu URL y tu clave pública (anon key):
```javascript
window.SUPABASE_CONFIG = {
  url: "https://TU-PROYECTO.supabase.co",
  anonKey: "TU-ANON-KEY",
};
```

### 3. Crear usuario
En Supabase ➔ **Authentication** ➔ **Users** ➔ **Add user**, crea tu correo y contraseña para acceder al panel.

### 4. Abrir la aplicación
Abre `frontend/index.html` en el navegador con cualquier servidor local (ej. Live Server en VS Code).
