/**
 * DASHBOARD DE TAMALES — API (Google Apps Script Web App)
 * Se implementa como aplicación web y se consume desde una página web
 * separada, usando la URL de implementación (.../exec).
 *
 * Todo se hace por GET + JSONP (una etiqueta <script>), porque los
 * web apps de Apps Script no siempre devuelven el header
 * Access-Control-Allow-Origin que fetch() necesita entre orígenes
 * distintos. Con JSONP se evita ese problema por completo.
 *
 * Si no mandas "callback" en la URL, responde JSON normal (útil para
 * probar pegando la URL directo en el navegador).
 */

const SHEET_PEDIDOS = 'Pedidos';
const SHEET_CONFIG = 'Config';
const SHEET_INVENTARIO = 'Inventario';
const SHEET_CIERRES = 'Cierres';

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];

/**
 * Ejecuta esta función manualmente desde el editor (selector de función junto
 * al botón ▶ Ejecutar) para crear todas las pestañas sin depender de una
 * petición web. Pide autorización de permisos la primera vez.
 */
function inicializarHojas() {
  ensureSheets();
  Logger.log('Listo: pestañas Pedidos, Config, Inventario y Cierres creadas o verificadas.');
}

/* ---------------------- BLOQUEO ---------------------- */

/**
 * Ejecuta fn() con el bloqueo del script activo, para que dos peticiones
 * concurrentes (doble clic, reintento de red, etc.) no lean el mismo
 * inventario "disponible" y ambas pasen la validación antes de escribir.
 * Sin esto, crearPedido/editarPedido pueden generar pedidos duplicados
 * o vender más tamales de los que hay.
 */
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000); // espera hasta 15s si otra petición está escribiendo
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ---------------------- ENRUTADOR ---------------------- */

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || 'dashboard';
  let response;
  try {
    let data;
    switch (action) {
      case 'dashboard':
        data = getDashboardData();
        break;
      case 'config':
        data = getConfig();
        break;
      case 'pedidos':
        data = listarPedidos(p.estado || null);
        break;
      case 'inventario':
        data = getInventarioSemana(p.semana || getWeekInfo(new Date()).key);
        break;
      case 'crearPedido':
        data = crearPedido(p.cliente, JSON.parse(p.items || '[]'), p.clientRequestId || null);
        break;
      case 'editarPedido':
        data = editarPedido(p.id, p.cliente, JSON.parse(p.items || '[]'));
        break;
      case 'completarPedido':
        data = completarPedido(p.id, Number(p.montoCobrado));
        break;
      case 'reabrirPedido':
        data = reabrirPedido(p.id);
        break;
      case 'eliminarPedido':
        data = eliminarPedido(p.id);
        break;
      case 'guardarConfig':
        data = guardarConfig(Number(p.precio), JSON.parse(p.tipos || '[]'));
        break;
      case 'guardarInventario':
        data = guardarInventario(p.semana, JSON.parse(p.items || '[]'));
        break;
      case 'guardarInversion':
        data = guardarInversion(p.semana, Number(p.inversion));
        break;
      case 'cerrarSemana':
        data = cerrarSemana(p.semana, p.inversion != null && p.inversion !== '' ? Number(p.inversion) : null);
        break;
      default:
        throw new Error('Acción no reconocida: ' + action);
    }
    response = { ok: true, data };
  } catch (err) {
    response = { ok: false, error: err.message };
  }
  return buildOutput(response, p.callback);
}

function buildOutput(response, callback) {
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(response) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------- HOJA DE CÁLCULO ---------------------- */

function getSS() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheets() {
  const ss = getSS();

  let pedidos = ss.getSheetByName(SHEET_PEDIDOS);
  if (!pedidos) {
    pedidos = ss.insertSheet(SHEET_PEDIDOS);
    pedidos.appendRow([
      'ID', 'Fecha', 'Semana', 'Cliente', 'Detalle',
      'CantidadTotal', 'MontoEsperado', 'MontoCobrado', 'Estado', 'FechaCompletado'
    ]);
    pedidos.setFrozenRows(1);
  }

  let config = ss.getSheetByName(SHEET_CONFIG);
  if (!config) {
    config = ss.insertSheet(SHEET_CONFIG);
    config.getRange('A1').setValue('Precio por tamal');
    config.getRange('B1').setValue(15);
    config.getRange('A3').setValue('Tipos de tamal');
    config.getRange('A4').setValue('Verde');
    config.getRange('A5').setValue('Rojo');
    config.getRange('A6').setValue('Dulce');
    config.getRange('A7').setValue('Rajas con queso');
  }

  let inventario = ss.getSheetByName(SHEET_INVENTARIO);
  if (!inventario) {
    inventario = ss.insertSheet(SHEET_INVENTARIO);
    inventario.appendRow(['Semana', 'Tipo', 'CantidadInicial']);
    inventario.setFrozenRows(1);
  }

  let cierres = ss.getSheetByName(SHEET_CIERRES);
  if (!cierres) {
    cierres = ss.insertSheet(SHEET_CIERRES);
    cierres.appendRow(['Semana', 'Inversion', 'FechaRegistro']);
    cierres.setFrozenRows(1);
  }

  return { pedidos, config, inventario, cierres };
}

/* ---------------------- SEMANAS (por mes, formato legible) ---------------------- */

/** Devuelve la clave de semana con formato "YYYY-MM-Sx" (semana x del mes). */
function getWeekInfo(date) {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexado
  const day = date.getDate();
  const weekNum = Math.ceil(day / 7); // 1..5
  const key = year + '-' + String(month + 1).padStart(2, '0') + '-S' + weekNum;
  return { key, year, month, weekNum };
}

/** Convierte "2026-07-S3" -> "Semana 3 de Julio 2026". */
function getWeekLabel(weekKey) {
  const parts = weekKey.split('-');
  const year = parts[0];
  const month = Number(parts[1]) - 1;
  const weekNum = parts[2].replace('S', '');
  const nombreMes = MESES[month] || '';
  const mesCap = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
  return 'Semana ' + weekNum + ' de ' + mesCap + ' ' + year;
}

/* ---------------------- CONFIG ---------------------- */

function getConfig() {
  const { config } = ensureSheets();
  const precio = config.getRange('B1').getValue();
  const lastRow = config.getLastRow();
  let tipos = [];
  if (lastRow >= 4) {
    tipos = config.getRange(4, 1, lastRow - 3, 1).getValues().flat().filter(String);
  }
  return { precio: Number(precio) || 0, tipos };
}

function guardarConfig(precio, tipos) {
  const { config } = ensureSheets();
  config.getRange('B1').setValue(precio);
  const lastRow = config.getLastRow();
  if (lastRow >= 4) config.getRange(4, 1, lastRow - 3, 1).clearContent();
  (tipos || []).forEach((t, i) => config.getRange(4 + i, 1).setValue(t));
  return getConfig();
}

function getSemanaActiva() {
  const { config } = ensureSheets();
  const semana = config.getRange('E1').getValue();
  return semana ? String(semana) : '';
}

function guardarSemanaActiva(semana) {
  const { config } = ensureSheets();
  config.getRange('E1').setValue(String(semana));
  return String(semana);
}

function getSemanaActualContext() {
  const semanaActiva = getSemanaActiva();
  if (semanaActiva) return semanaActiva;
  return getWeekInfo(new Date()).key;
}

function getSemanaSiguiente(semana) {
  const parts = String(semana || '').split('-');
  if (parts.length < 3) return semana;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const weekNum = Number(parts[2].replace('S', ''));
  const startDate = new Date(year, month - 1, 1 + (weekNum - 1) * 7);
  const nextDate = new Date(startDate);
  nextDate.setDate(startDate.getDate() + 7);
  return getWeekInfo(nextDate).key;
}

/* ---------------------- PEDIDOS ---------------------- */

/**
 * items: [{tipo: 'Verde', cantidad: 3}, ...]
 * clientRequestId: id único que genera el front por cada intento de envío.
 * Si la misma petición llega dos veces (doble tap, reintento de red, JSONP
 * que se resolvió tarde y el usuario volvió a mandar), se devuelve el
 * mismo pedido ya creado en vez de duplicarlo.
 */
function crearPedido(cliente, items, clientRequestId) {
  if (!cliente) throw new Error('Falta el nombre del cliente');
  if (!items || !items.length) throw new Error('El pedido no tiene tamales');

  return withLock(() => {
    const cache = CacheService.getScriptCache();
    const cacheKey = clientRequestId ? 'pedido_' + clientRequestId : null;

    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    const now = new Date();
    const semana = getSemanaActualContext();

    // Validar contra inventario configurado para esta semana
    const inventarioActual = getInventarioSemana(semana);
    const invPorTipo = {};
    inventarioActual.forEach(i => { invPorTipo[i.tipo] = i; });

    items.forEach(item => {
      const inv = invPorTipo[item.tipo];
      if (inv && inv.configurado && Number(item.cantidad) > inv.disponible) {
        throw new Error(
          'No hay suficiente inventario de "' + item.tipo + '". Disponible: ' + inv.disponible
        );
      }
    });

    const { pedidos } = ensureSheets();
    const { precio } = getConfig();
    const cantidadTotal = items.reduce((s, i) => s + Number(i.cantidad || 0), 0);
    const montoEsperado = cantidadTotal * precio;
    const id = Utilities.getUuid();

    pedidos.appendRow([
      id, now, semana, cliente, JSON.stringify(items),
      cantidadTotal, montoEsperado, '', 'Pendiente', ''
    ]);

    const result = { id, montoEsperado, semana };
    if (cacheKey) {
      // Se guarda por 2 minutos: tiempo de sobra para cubrir un reintento
      // de red, pero sin dejar basura acumulada en el caché.
      cache.put(cacheKey, JSON.stringify(result), 120);
    }
    return result;
  });
}

/**
 * Reemplaza cliente y detalle de un pedido pendiente existente.
 * Solo se permite editar pedidos en estado "Pendiente" (uno ya completado
 * ya afectó las ganancias registradas y no debería cambiar en silencio).
 * Al validar inventario, se le "devuelven" al disponible las cantidades
 * que el propio pedido ya tenía reservadas, para no marcar falso
 * excedente contra sí mismo.
 */
function editarPedido(id, cliente, items) {
  if (!id) throw new Error('Falta el id del pedido');
  if (!cliente) throw new Error('Falta el nombre del cliente');
  if (!items || !items.length) throw new Error('El pedido no tiene tamales');

  return withLock(() => {
    const { pedidos } = ensureSheets();
    const lastRow = pedidos.getLastRow();
    if (lastRow < 2) throw new Error('Pedido no encontrado');
    const ids = pedidos.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const rowIndex = ids.indexOf(id);
    if (rowIndex === -1) throw new Error('Pedido no encontrado');
    const row = rowIndex + 2;

    const estadoActual = pedidos.getRange(row, 9).getValue();
    if (estadoActual !== 'Pendiente') {
      throw new Error('Solo se pueden editar pedidos pendientes');
    }

    const semana = pedidos.getRange(row, 3).getValue();

    const detalleOriginal = JSON.parse(pedidos.getRange(row, 5).getValue() || '[]');
    const reservadoOriginal = {};
    detalleOriginal.forEach(d => {
      reservadoOriginal[d.tipo] = (reservadoOriginal[d.tipo] || 0) + Number(d.cantidad);
    });

    const inventarioActual = getInventarioSemana(semana);
    const invPorTipo = {};
    inventarioActual.forEach(i => { invPorTipo[i.tipo] = i; });

    items.forEach(item => {
      const inv = invPorTipo[item.tipo];
      if (inv && inv.configurado) {
        const disponibleAjustado = inv.disponible + (reservadoOriginal[item.tipo] || 0);
        if (Number(item.cantidad) > disponibleAjustado) {
          throw new Error(
            'No hay suficiente inventario de "' + item.tipo + '". Disponible: ' + disponibleAjustado
          );
        }
      }
    });

    const { precio } = getConfig();
    const cantidadTotal = items.reduce((s, i) => s + Number(i.cantidad || 0), 0);
    const montoEsperado = cantidadTotal * precio;

    pedidos.getRange(row, 4).setValue(cliente);
    pedidos.getRange(row, 5).setValue(JSON.stringify(items));
    pedidos.getRange(row, 6).setValue(cantidadTotal);
    pedidos.getRange(row, 7).setValue(montoEsperado);

    return { id, montoEsperado, semana };
  });
}

function listarPedidos(filtroEstado) {
  const { pedidos } = ensureSheets();
  const lastRow = pedidos.getLastRow();
  if (lastRow < 2) return [];
  const data = pedidos.getRange(2, 1, lastRow - 1, 10).getValues();
  return data
    .map(row => ({
      id: row[0],
      fecha: row[1],
      semana: row[2],
      cliente: row[3],
      detalle: JSON.parse(row[4] || '[]'),
      cantidadTotal: row[5],
      montoEsperado: row[6],
      montoCobrado: row[7],
      estado: row[8],
      fechaCompletado: row[9]
    }))
    .filter(p => !filtroEstado || p.estado === filtroEstado)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

function completarPedido(id, montoCobrado) {
  return withLock(() => {
    const { pedidos } = ensureSheets();
    const lastRow = pedidos.getLastRow();
    if (lastRow < 2) throw new Error('Pedido no encontrado');
    const ids = pedidos.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const rowIndex = ids.indexOf(id);
    if (rowIndex === -1) throw new Error('Pedido no encontrado');
    const row = rowIndex + 2;
    pedidos.getRange(row, 8).setValue(Number(montoCobrado));
    pedidos.getRange(row, 9).setValue('Completado');
    pedidos.getRange(row, 10).setValue(new Date());
    return true;
  });
}

function reabrirPedido(id) {
  return withLock(() => {
    const { pedidos } = ensureSheets();
    const lastRow = pedidos.getLastRow();
    const ids = pedidos.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const rowIndex = ids.indexOf(id);
    if (rowIndex === -1) throw new Error('Pedido no encontrado');
    const row = rowIndex + 2;
    pedidos.getRange(row, 8).setValue('');
    pedidos.getRange(row, 9).setValue('Pendiente');
    pedidos.getRange(row, 10).setValue('');
    return true;
  });
}

/**
 * Borra el pedido. No hace falta "devolver" tamales al inventario a mano:
 * getInventarioSemana calcula "vendido" sumando el detalle de los pedidos
 * vivos de esa semana, así que al desaparecer la fila el disponible se
 * recalcula solo en la siguiente lectura.
 */
function eliminarPedido(id) {
  return withLock(() => {
    const { pedidos } = ensureSheets();
    const lastRow = pedidos.getLastRow();
    if (lastRow < 2) return false;
    const ids = pedidos.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const rowIndex = ids.indexOf(id);
    if (rowIndex === -1) return false;
    pedidos.deleteRow(rowIndex + 2);
    return true;
  });
}

/* ---------------------- INVENTARIO ---------------------- */

function leerInventarioRaw(semana) {
  const { inventario } = ensureSheets();
  const lastRow = inventario.getLastRow();
  if (lastRow < 2) return {};
  const data = inventario.getRange(2, 1, lastRow - 1, 3).getValues();
  const map = {};
  data.forEach(row => { if (row[0] === semana) map[row[1]] = Number(row[2]); });
  return map;
}

function calcularVendidoPorTipo(semana) {
  const pedidosSemana = listarPedidos(null).filter(p => p.semana === semana);
  const map = {};
  pedidosSemana.forEach(p => {
    p.detalle.forEach(d => { map[d.tipo] = (map[d.tipo] || 0) + Number(d.cantidad); });
  });
  return map;
}

/** Devuelve, para cada tipo configurado en Config, cuánto hay, cuánto se
 *  ha comprometido en pedidos de esa semana, y cuánto queda disponible.
 *  Si nunca se configuró inventario para un tipo esa semana, disponible = null
 *  (sin límite). */
function getInventarioSemana(semana) {
  const { tipos } = getConfig();
  const inicial = leerInventarioRaw(semana);
  const vendido = calcularVendidoPorTipo(semana);
  return tipos.map(tipo => {
    const configurado = Object.prototype.hasOwnProperty.call(inicial, tipo);
    const cantidadInicial = configurado ? inicial[tipo] : null;
    const v = vendido[tipo] || 0;
    const disponible = configurado ? Math.max(cantidadInicial - v, 0) : null;
    return { tipo, cantidadInicial, vendido: v, disponible, configurado };
  });
}

/** items: [{tipo, cantidad}] — cantidad inicial de esa semana por tipo */
function guardarInventario(semana, items) {
  return withLock(() => {
    const { inventario } = ensureSheets();
    const lastRow = inventario.getLastRow();
    const data = lastRow >= 2 ? inventario.getRange(2, 1, lastRow - 1, 3).getValues() : [];

    (items || []).forEach(item => {
      let found = false;
      for (let i = 0; i < data.length; i++) {
        if (data[i][0] === semana && data[i][1] === item.tipo) {
          inventario.getRange(i + 2, 3).setValue(Number(item.cantidad));
          found = true;
          break;
        }
      }
      if (!found) {
        inventario.appendRow([semana, item.tipo, Number(item.cantidad)]);
      }
    });

    return getInventarioSemana(semana);
  });
}

/* ---------------------- CIERRES DE SEMANA (inversión / utilidad) ---------------------- */

function leerCierres() {
  const { cierres } = ensureSheets();
  const lastRow = cierres.getLastRow();
  if (lastRow < 2) return {};
  const data = cierres.getRange(2, 1, lastRow - 1, 3).getValues();
  const map = {};
  data.forEach(row => { map[row[0]] = { inversion: Number(row[1]), fechaRegistro: row[2] }; });
  return map;
}

function guardarInversion(semana, inversion) {
  return withLock(() => {
    const { cierres } = ensureSheets();
    const lastRow = cierres.getLastRow();
    const data = lastRow >= 2 ? cierres.getRange(2, 1, lastRow - 1, 3).getValues() : [];
    let found = false;
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === semana) {
        cierres.getRange(i + 2, 2).setValue(Number(inversion));
        cierres.getRange(i + 2, 3).setValue(new Date());
        found = true;
        break;
      }
    }
    if (!found) cierres.appendRow([semana, Number(inversion), new Date()]);
    return obtenerResumenSemanal().find(s => s.semana === semana);
  });
}

function cerrarSemana(semana, inversion) {
  return withLock(() => {
    const semanaActual = semana || getSemanaActualContext();
    const semanaSiguiente = getSemanaSiguiente(semanaActual);

    if (inversion != null && inversion !== '') {
      guardarInversionSinLock(semanaActual, Number(inversion));
    }

    const { tipos } = getConfig();
    const { inventario } = ensureSheets();
    const lastRow = inventario.getLastRow();
    const data = lastRow >= 2 ? inventario.getRange(2, 1, lastRow - 1, 3).getValues() : [];

    tipos.forEach(tipo => {
      let found = false;
      for (let i = 0; i < data.length; i++) {
        if (data[i][0] === semanaSiguiente && data[i][1] === tipo) {
          inventario.getRange(i + 2, 3).setValue(0);
          found = true;
          break;
        }
      }
      if (!found) {
        inventario.appendRow([semanaSiguiente, tipo, 0]);
      }
    });

    guardarSemanaActiva(semanaSiguiente);
    return {
      semanaCerrada: semanaActual,
      semanaNueva: semanaSiguiente,
      inventario: getInventarioSemana(semanaSiguiente)
    };
  });
}

/** Misma lógica que guardarInversion pero sin volver a pedir el lock
 *  (para usarse dentro de cerrarSemana, que ya lo tiene tomado). */
function guardarInversionSinLock(semana, inversion) {
  const { cierres } = ensureSheets();
  const lastRow = cierres.getLastRow();
  const data = lastRow >= 2 ? cierres.getRange(2, 1, lastRow - 1, 3).getValues() : [];
  let found = false;
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === semana) {
      cierres.getRange(i + 2, 2).setValue(Number(inversion));
      cierres.getRange(i + 2, 3).setValue(new Date());
      found = true;
      break;
    }
  }
  if (!found) cierres.appendRow([semana, Number(inversion), new Date()]);
}

function obtenerResumenSemanal() {
  const completados = listarPedidos('Completado');
  const map = {};
  completados.forEach(p => {
    if (!map[p.semana]) map[p.semana] = { semana: p.semana, total: 0, pedidos: 0 };
    map[p.semana].total += Number(p.montoCobrado || 0);
    map[p.semana].pedidos += 1;
  });
  const cierres = leerCierres();
  return Object.values(map)
    .map(r => {
      const c = cierres[r.semana];
      const inversion = c ? c.inversion : null;
      const utilidad = (inversion != null) ? (r.total - inversion) : null;
      return {
        semana: r.semana,
        label: getWeekLabel(r.semana),
        total: r.total,
        pedidos: r.pedidos,
        inversion,
        utilidad,
        registrada: !!c
      };
    })
    .sort((a, b) => a.semana.localeCompare(b.semana));
}

/* ---------------------- DASHBOARD ---------------------- */

function getDashboardData() {
  const todos = listarPedidos(null);
  const semanaActual = getSemanaActualContext();
  return {
    todos,
    completados: todos.filter(p => p.estado === 'Completado'),
    pendientes: todos.filter(p => p.estado === 'Pendiente'),
    resumenSemanal: obtenerResumenSemanal(),
    config: getConfig(),
    inventario: getInventarioSemana(semanaActual),
    semanaActual,
    semanaActualLabel: getWeekLabel(semanaActual)
  };
}