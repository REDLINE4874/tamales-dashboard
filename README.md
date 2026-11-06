# Tamales Dashboard

Panel web para administrar pedidos, inventario semanal, cobros, ganancias y tipos de tamal.

## Funcionalidades

- Crear, editar, cobrar y eliminar pedidos.
- Control de inventario por tipo de tamal.
- Inventario controlado por día y producto.
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

### Pedidos de clientes

La vista pública se publica como un sitio estático independiente desde `frontend-pedidos/`; el panel continúa en `frontend/`:

- Panel: URL del servicio `tamales-dashboard` en Render.
- Clientes: URL del servicio `tamales-pedidos` en Render.

El archivo [`render.yaml`](./render.yaml) define ambos servicios. Al crear o sincronizar el Blueprint en Render, publica cada servicio desde su propio directorio raíz. La página de clientes tiene un `index.html` propio y una copia de los recursos que necesita, además de la misma configuración pública de Supabase.

Ambas vistas usan el mismo proyecto de Supabase. Después de instalar la base inicial con `supabase/tamales.sql`, ejecuta `supabase/pedidos_publicos.sql` y luego `supabase/inventario_diario.sql` desde el SQL Editor de Supabase. Si ya ejecutaste versiones anteriores, vuelve a ejecutar los archivos en ese orden para incorporar los cambios.

Al continuar al checkout, las cantidades se apartan durante 10 minutos. Al enviar nombre y teléfono, el apartado se convierte en pedido pendiente del panel, sin pago en línea. Si el cliente cancela o deja vencer el tiempo, el inventario se libera. Sus datos de contacto se recuerdan solo en el navegador mediante `localStorage`.

La configuración del panel permite activar los atoles chico (500 ml) y grande (1 L), fijar sus precios y registrar sus cantidades en Inventario. El panel mantiene su formulario habitual para capturar pedidos. El inventario y la apertura de pedidos en línea se controlan por día desde la sección Inventario.

## Inventario diario y cierre semanal

El inventario se registra para cada fecha. Los pedidos de panel, pedidos web y apartados temporales descuentan del inventario del día correspondiente. Si no hay cantidad cargada para la fecha actual, la disponibilidad se considera `0`.

Al guardar el inventario del día, el panel permite elegir por separado si abre los pedidos de tamales y bebidas. En Inventario también se pueden abrir o cerrar ambas categorías de forma independiente. La vista del cliente muestra solo las categorías abiertas, y el cambio de fecha las cierra hasta que se registre el inventario del nuevo día.

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
