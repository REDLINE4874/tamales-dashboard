# Tamales Dashboard

Panel web para administrar pedidos, inventario semanal, cobros, ganancias y tipos de tamal.

## Funcionalidades

- Crear, editar, cobrar y eliminar pedidos.
- Control de inventario por tipo de tamal.
- Inventario semanal reiniciado en `0` al cerrar la semana.
- Validación para impedir pedidos sin stock disponible.
- Resumen de ventas, inversión y utilidad.
- Histórico semanal con filtros por mes y año.
- Configuración de tipos y precios.
- Autenticación mediante Supabase.
- Interfaz responsive para celulares.

## Estructura

```text
tamales-dashboard/
├── frontend/
│   ├── index.html
│   └── src/
│       ├── css/
│       │   ├── styles.css
│       │   ├── site-auth.css
│       │   └── modules/
│       └── js/
│           ├── api.js
│           ├── app.js
│           ├── configuracion.js
│           ├── controles.js
│           ├── ganancias.js
│           ├── inventario.js
│           ├── pedidos.js
│           ├── site-auth.js
│           └── supabase-config.js
├── supabase/
│   └── tamales.sql
└── render.yaml
```

## Configuración de Supabase

1. Crea un proyecto en [Supabase](https://supabase.com).
2. Abre el SQL Editor y ejecuta [`supabase/tamales.sql`](./supabase/tamales.sql).
3. Configura la URL y la clave pública en `frontend/src/js/supabase-config.js`:

```js
window.SUPABASE_CONFIG = {
  url: "https://TU-PROYECTO.supabase.co",
  anonKey: "TU-ANON-KEY",
};
```

La clave `anonKey` es pública para el frontend. Nunca coloques una `service_role key` en estos archivos.

Después crea al menos un usuario en **Authentication > Users** de Supabase.

## Ejecutar localmente

El frontend es estático, pero debe abrirse mediante un servidor local para evitar restricciones del navegador:

```bash
cd frontend
npx serve .
```

También puedes usar Live Server de VS Code. Abre la URL que proporcione el servidor y no el archivo `index.html` directamente.

## Despliegue

El archivo `render.yaml` contiene la configuración para publicar el frontend como sitio estático en Render.

## Inventario y cierre semanal

Cada tipo de tamal tiene inventario controlado. Si no se registra una cantidad, su stock se considera `0`; no existe inventario ilimitado.

Al cerrar una semana:

1. Se registra la inversión opcional.
2. Se crea o actualiza la siguiente semana.
3. Todos los tipos configurados comienzan con inventario `0`.
4. La semana activa cambia automáticamente.

## Validación rápida

Para revisar la sintaxis JavaScript:

```bash
node --check frontend/src/js/app.js
node --check frontend/src/js/api.js
node --check frontend/src/js/pedidos.js
```
