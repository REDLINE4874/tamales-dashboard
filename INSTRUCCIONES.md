# Dashboard de Tamales — frontend + backend (Apps Script)

El proyecto separa la interfaz web del backend de Apps Script. El código fuente
de cada parte vive en su carpeta `src`:

```
tamales-dashboard/
├── frontend/
│   ├── index.html             ← página de entrada
│   └── src/
│       ├── css/
│       │   ├── styles.css      ← punto de entrada que importa los módulos CSS
│       │   └── modules/        ← estilos globales, vistas, formularios y responsive
│       ├── config.js         ← aquí pegas la URL de implementación
│       └── js/
│           ├── api.js        ← comunicación JSONP con Apps Script
│           ├── app.js        ← estado y arranque de la interfaz
│           ├── pedidos.js    ← creación, edición, cobro y eliminación
│           ├── inventario.js ← consulta y guardado del inventario
│           ├── ganancias.js  ← dashboard, cierres e histórico
│           └── configuracion.js ← administración de tipos y precios
├── backend/                  ← proyecto de Apps Script (clasp)
│   ├── src/
│   │   ├── appsscript.json
│   │   └── Codigo.gs        ← doGet / doPost devuelven JSON
│   ├── package.json
│   ├── package-lock.json
│   └── .clasp.json
└── render.yaml               ← despliegue del frontend estático
```

## 1. Desplegar la API en Apps Script

```bash
cd backend
npm install
npx clasp login
npx clasp create --type sheets --title "Tamales - Base de datos" --rootDir ./src
```
Si `clasp create` sobrescribe `src/appsscript.json`, vuelve a pegar el contenido original (define `access: ANYONE_ANONYMOUS`, necesario para que la web externa pueda llamarla sin login).

```bash
npm run push
npm run deploy
```
`npm run deploy` actualiza automáticamente `frontend/src/config.js` con la URL de la implementación recién creada. Si usas `npm run deploy -- --deploymentId <id>` para actualizar una implementación existente, también actualiza el archivo con su URL.

> Cada vez que cambies `Codigo.gs`: `npm run push` y luego `npm run deploy`. Para actualizar la misma implementación en vez de crear una nueva URL, usa `npm run deployments` y ejecuta `npm run deploy -- --deploymentId <deploymentId>`.

(si te marca un error de logeo usa este comando npx clasp login)

## 2. Conectar la página web

La URL queda configurada automáticamente por `npm run deploy`. Si la cambiaste manualmente en Google Apps Script, puedes seguir copiándola en `frontend/src/config.js`:
```js
const API_URL = "https://script.google.com/macros/s/XXXXXXX/exec";
```
Si publicas el frontend en Render u otro hosting, vuelve a desplegarlo para publicar el `config.js` actualizado.

## 3. Ejecutar la web

Es HTML/CSS/JS puro, sin build. Puedes:
- Abrir `frontend/index.html` directamente en el navegador, o
- Servir la carpeta `frontend` con cualquier servidor estático, por ejemplo con la extensión **Live Server** de VS Code o `npx serve frontend`.
- Desplegar en Render usando la configuración de `render.yaml`, o publicar la carpeta `frontend` en Netlify/Vercel/GitHub Pages.

## Cómo se comunican (JSONP, no fetch)

Los web apps de Apps Script no siempre devuelven el header `Access-Control-Allow-Origin`
que `fetch()` necesita para leer la respuesta entre orígenes distintos (verás el error
`blocked by CORS policy` en la consola si lo intentas con fetch). Por eso `app.js` usa
**JSONP**: inserta una etiqueta `<script src="{URL}?...&callback=nombreFn">`, que no está
sujeta a CORS porque no es una petición XHR/fetch.

Todo — lecturas y escrituras — se manda como `GET` con parámetros en la URL más
`&callback=...`. Si quieres probar una acción manualmente pegando la URL en el navegador,
solo omite `callback` y verás JSON normal en vez de la llamada envuelta.

Acciones disponibles (todas por GET):
| Acción | Parámetros |
|---|---|
| `dashboard` | — |
| `config` | — |
| `pedidos` | `estado` (opcional, ej. `Pendiente`) |
| `crearPedido` | `cliente`, `items` (JSON: `[{"tipo":"Verde","cantidad":3}]`) |
| `completarPedido` | `id`, `montoCobrado` |
| `reabrirPedido` | `id` |
| `eliminarPedido` | `id` |
| `guardarConfig` | `precio`, `tipos` (JSON: `["Verde","Rojo"]`) |

Ejemplo para probar en el navegador:
```
{API_URL}?action=dashboard
{API_URL}?action=crearPedido&cliente=Ana&items=[{"tipo":"Verde","cantidad":3}]
```

## 4. Configurar tu negocio
En la hoja de cálculo (se crean solas al primer llamado a la API), 4 pestañas:
- **Config**: B1 precio por tamal; columna A desde fila 4, tipos de tamal.
- **Pedidos**: se llena sola con cada comanda.
- **Inventario**: se llena sola desde la pestaña "Inventario" del dashboard (cantidad inicial por tipo, por semana).
- **Cierres**: se llena sola al registrar la inversión de una semana.

## Novedades de esta versión
- **Semanas legibles**: se agrupan como "Semana 3 de Julio 2026" en vez de "S30".
- **Ganancias por mes**: el filtro del gráfico muestra las semanas, el total y la cantidad de pedidos completados del mes seleccionado. Los datos se calculan automáticamente desde los pedidos completados que ya están guardados; cada pedido permanece asociado al mes de su semana registrada.
- **Inventario por tipo**: en la pestaña "Inventario" defines cuántos tamales de cada tipo tienes esta semana. Al crear una comanda, si pides más de lo disponible, la web avisa y bloquea el botón hasta que ajustes las cantidades. El backend también valida, así que nunca se puede vender de más aunque dos personas usen la app a la vez.
- **Cierre de semana**: en "Ganancias" (semana actual) y en cada semana del "Histórico" puedes registrar cuánto invertiste. La utilidad (ganancia − inversión) se calcula y queda guardada.

Acciones nuevas (mismo patrón GET + JSONP que las demás):
| Acción | Parámetros |
|---|---|
| `inventario` | `semana` (opcional, por defecto la actual) |
| `guardarInventario` | `semana`, `items` (JSON: `[{"tipo":"Verde","cantidad":40}]`) |
| `guardarInversion` | `semana`, `inversion` |

## 5. Acceso de tu empleado
Comparte la Hoja de Cálculo con tu empleado como **Editor** (el script escribe ahí). La página web la puede usar cualquiera con el enlace, sin necesitar login de Google, porque el acceso de la API está configurado como `ANYONE_ANONYMOUS`.

---

### Qué hace el dashboard
- **Nuevo pedido**: crea una comanda (cliente + tipos/cantidades). Se guarda como "Pendiente".
- **Pedidos activos**: muestra los contadores de pedidos pendientes y completados de la semana actual, además de los tickets visuales. "Marcar pagado" pide el monto realmente cobrado y pasa a "Completado".
- **Tipos y precios**: se editan en una tabla; los botones de cantidad de cada tamal suman o restan unidades enteras.
- **Controles personalizados**: los selectores y listas desplegables usan menús propios con teclado y estilo de la aplicación; los botones tienen estados de interacción y foco visibles.
- **Procesamiento de pedidos**: muestra indicadores de carga y mensajes de éxito durante las operaciones; las confirmaciones y errores se presentan en diálogos personalizados.
- **Ganancias**: gráfica semanal filtrable por mes + total y cantidad de pedidos completados del mes seleccionado.
- **Histórico**: tabla semanal filtrable por mes y año (por defecto, el periodo actual), con contador de ventas y utilidad mensual, además de inversión, utilidad semanal y pedidos expandibles.
