# Dashboard de Tamales — API (Apps Script) + Web independiente

Dos proyectos separados, tal como en tus proyectos anteriores:

```
tamales-dashboard/
├── api/                     ← proyecto de Apps Script (clasp), solo backend
│   ├── src/
│   │   ├── appsscript.json
│   │   └── Codigo.gs        ← doGet / doPost devuelven JSON
│   ├── package.json
│   └── .claspignore
└── web/                     ← página web independiente (estática)
    ├── index.html
    ├── styles.css
    ├── config.js            ← aquí pegas la URL de implementación
    └── app.js                ← usa fetch() contra esa URL
```

## 1. Desplegar la API en Apps Script

```bash
cd api
npm install
npx clasp login
npx clasp create --type sheets --title "Tamales - Base de datos" --rootDir ./src
```
Si `clasp create` sobrescribe `src/appsscript.json`, vuelve a pegar el contenido original (define `access: ANYONE_ANONYMOUS`, necesario para que la web externa pueda llamarla sin login).

```bash
npm run push
npm run deploy
npm run open:webapp
```
Copia la URL que termina en `/exec` — esa es tu URL de implementación.

> Cada vez que cambies `Codigo.gs`: `npm run push` y luego `clasp deploy` de nuevo (o `clasp deploy -i <deploymentId>` para actualizar la misma implementación en vez de crear una nueva URL — revisa `npm run deployments`).

(si te marca un error de logeo usa este comando npx clasp login)

## 2. Conectar la página web

En `web/config.js`:
```js
const API_URL = "https://script.google.com/macros/s/XXXXXXX/exec";
```
Pega ahí la URL que copiaste. Nada más necesita tocarse.

## 3. Ejecutar la web

Es HTML/CSS/JS puro, sin build. Puedes:
- Abrir `web/index.html` directo en el navegador, o
- Servirla con cualquier servidor estático, por ejemplo con la extensión **Live Server** de VS Code, o `npx serve web`, o desplegarla en Netlify/Vercel/GitHub Pages.

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
- **Pedidos activos**: tickets visuales. "Marcar pagado" pide el monto realmente cobrado y pasa a "Completado".
- **Ganancias**: gráfica semanal + totales rápidos, solo con pedidos completados.
- **Histórico**: semanas cerradas con total y detalle de cada pedido, expandible.
