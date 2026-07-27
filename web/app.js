/* ==========================================================
   API — llamadas a la URL de implementación de Apps Script
   vía JSONP (etiqueta <script>), para evitar por completo el
   bloqueo de CORS que Apps Script no resuelve con fetch().
   ========================================================== */

function jsonpRequest(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = 'tamalesCb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const script = document.createElement('script');

    const cleanup = () => { delete window[callbackName]; script.remove(); };

    window[callbackName] = (response) => {
      cleanup();
      if (response && response.ok) resolve(response.data);
      else reject(new Error((response && response.error) || 'Error desconocido'));
    };

    const url = new URL(API_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('callback', callbackName);
    Object.entries(params).forEach(([k, v]) => {
      if (v == null) return;
      url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
    });

    script.src = url.toString();
    script.onerror = () => { cleanup(); reject(new Error('No se pudo conectar con la API')); };
    document.body.appendChild(script);
  });
}

function apiGet(action, params = {}) { return jsonpRequest(action, params); }
function apiPost(action, payload = {}) { return jsonpRequest(action, payload); }

/* ==========================================================
   ESTADO Y ARRANQUE
   ========================================================== */

let STATE = {
  config: { precio: 0, tipos: [] },
  pendientes: [], completados: [], resumenSemanal: [],
  inventario: [], semanaActual: '', semanaActualLabel: ''
};
let chartsReady = false;

google.charts.load('current', { packages: ['corechart'] });
google.charts.setOnLoadCallback(() => { chartsReady = true; if (STATE.resumenSemanal.length) drawChart(); });

document.addEventListener('DOMContentLoaded', () => {
  if (!API_URL || API_URL.includes('PEGA_AQUI')) {
    setConnStatus('Falta configurar API_URL en config.js', 'error');
  }
  setupNav();
  setupForm();
  setupModal();
  document.getElementById('guardarInventarioBtn').addEventListener('click', guardarInventario);
  cargarTodo();
});

function setConnStatus(text, cls) {
  const el = document.getElementById('connStatus');
  el.textContent = text;
  el.className = 'conn-status' + (cls ? ' ' + cls : '');
}

function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
    });
  });
}

async function cargarTodo() {
  try {
    setConnStatus('Sincronizando…');
    const data = await apiGet('dashboard');
    onDataLoaded(data);
    setConnStatus('Conectado', 'ok');
  } catch (err) {
    onError(err);
    setConnStatus('Sin conexión con la API', 'error');
  }
}

function onDataLoaded(data) {
  STATE.config = data.config;
  STATE.pendientes = data.pendientes;
  STATE.completados = data.completados;
  STATE.resumenSemanal = data.resumenSemanal;
  STATE.inventario = data.inventario;
  STATE.semanaActual = data.semanaActual;
  STATE.semanaActualLabel = data.semanaActualLabel;

  document.getElementById('currentWeekChip').textContent = data.semanaActualLabel;
  document.getElementById('inventarioSemanaLabel').textContent = data.semanaActualLabel;
  document.getElementById('dashboardSemanaLabel').textContent = data.semanaActualLabel.toLowerCase();

  if (!document.querySelector('.item-row')) addItemRow();
  else refreshItemRowOptions();

  renderPedidosActivos();
  renderInventario();
  renderDashboardStats();
  renderInvestCurrent();
  renderHistorico();
  if (chartsReady) drawChart();
}

function onError(err) {
  console.error(err);
  alert('Ocurrió un error: ' + (err && err.message ? err.message : err));
}

/* ==========================================================
   NUEVO PEDIDO
   ========================================================== */

function addItemRow() {
  const list = document.getElementById('itemsList');
  const row = document.createElement('div');
  row.className = 'item-row';
  
  // Se agregó el contenedor .cant-control con los botones + y -
  row.innerHTML = `
    <div class="item-row-main">
      <select class="item-tipo">${optionsHTML()}</select>
      <div class="cant-control">
        <button type="button" class="btn-minus">−</button>
        <input type="number" class="item-cant" min="1" value="1" placeholder="Cant.">
        <button type="button" class="btn-plus">+</button>
      </div>
      <button type="button" class="remove-item">✕</button>
    </div>
    <div class="item-hint"></div>
  `;
  
  // Eventos de eliminación y validación nativa
  row.querySelector('.remove-item').addEventListener('click', () => { row.remove(); refreshFormState(); });
  const input = row.querySelector('.item-cant');
  input.addEventListener('input', refreshFormState);
  row.querySelector('.item-tipo').addEventListener('change', refreshFormState);

  // Lógica de los botones + y -
  row.querySelector('.btn-minus').addEventListener('click', () => {
    // Evita que baje de 1
    input.value = Math.max(1, Number(input.value) - 1);
    refreshFormState();
  });
  
  row.querySelector('.btn-plus').addEventListener('click', () => {
    input.value = Number(input.value) + 1;
    refreshFormState();
  });

  list.appendChild(row);
  refreshFormState();
}

function optionsHTML() {
  return (STATE.config.tipos || []).map(t => `<option value="${t}">${t}</option>`).join('');
}

function refreshItemRowOptions() {
  document.querySelectorAll('.item-tipo').forEach(sel => { sel.innerHTML = optionsHTML(); });
  refreshFormState();
}

/** Recalcula total, valida disponibilidad de inventario por renglón y
 *  habilita/deshabilita el botón de crear comanda. */
function refreshFormState() {
  let cantidadTotal = 0;
  let hayExcedente = false;

  document.querySelectorAll('.item-row').forEach(row => {
    const tipo = row.querySelector('.item-tipo').value;
    const cantidad = Number(row.querySelector('.item-cant').value || 0);
    cantidadTotal += cantidad;

    const hint = row.querySelector('.item-hint');
    const inv = (STATE.inventario || []).find(i => i.tipo === tipo);

    if (!inv || !inv.configurado) {
      hint.textContent = 'Sin límite configurado';
      hint.className = 'item-hint';
    } else if (cantidad > inv.disponible) {
      hint.textContent = `Solo quedan ${inv.disponible} disponibles de ${tipo}`;
      hint.className = 'item-hint item-hint-error';
      hayExcedente = true;
    } else {
      hint.textContent = `Disponible: ${inv.disponible}`;
      hint.className = 'item-hint';
    }
  });

  const total = cantidadTotal * (STATE.config.precio || 0);
  document.getElementById('totalEstimado').textContent = '$' + total.toFixed(0);

  const warning = document.getElementById('pedidoWarning');
  const btn = document.getElementById('crearPedidoBtn');
  if (hayExcedente) {
    warning.hidden = false;
    warning.textContent = 'Ajusta las cantidades: no hay suficiente inventario para completar este pedido.';
    btn.disabled = true;
  } else {
    warning.hidden = true;
    btn.disabled = false;
  }
}

function setupForm() {
  document.getElementById('addItemBtn').addEventListener('click', addItemRow);
  document.getElementById('crearPedidoBtn').addEventListener('click', crearPedido);
}

async function crearPedido() {
  const cliente = document.getElementById('clienteInput').value.trim();
  if (!cliente) { alert('Escribe el nombre del cliente'); return; }

  const items = [];
  document.querySelectorAll('.item-row').forEach(r => {
    const tipo = r.querySelector('.item-tipo').value;
    const cantidad = Number(r.querySelector('.item-cant').value || 0);
    if (cantidad > 0) items.push({ tipo, cantidad });
  });
  if (!items.length) { alert('Agrega al menos un tamal'); return; }

  const btn = document.getElementById('crearPedidoBtn');
  btn.disabled = true; btn.textContent = 'Creando…';

  try {
    await apiPost('crearPedido', { cliente, items });
    document.getElementById('clienteInput').value = '';
    document.getElementById('itemsList').innerHTML = '';
    addItemRow();
    await cargarTodo();
    document.querySelector('.nav-item[data-view="activos"]').click();
  } catch (err) {
    onError(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Crear comanda';
  }
}

/* ==========================================================
   PEDIDOS ACTIVOS
   ========================================================== */

function renderPedidosActivos() {
  const wrap = document.getElementById('pedidosActivosList');
  if (!STATE.pendientes.length) {
    wrap.innerHTML = '<div class="empty-state">No hay comandas pendientes. Crea una desde “Nuevo pedido”.</div>';
    return;
  }
  wrap.innerHTML = STATE.pendientes.map(p => `
    <div class="ticket">
      <div class="ticket-head">
        <span class="ticket-cliente">${escapeHtml(p.cliente)}</span>
        <span class="ticket-badge">Pendiente</span>
      </div>
      <ul class="ticket-detalle">
        ${p.detalle.map(d => `<li><span>${escapeHtml(d.tipo)}</span><span>x${d.cantidad}</span></li>`).join('')}
      </ul>
      <div class="ticket-foot">
        <span class="ticket-total mono">$${Number(p.montoEsperado).toFixed(0)}</span>
        <button class="ticket-complete-btn" onclick="abrirModal('${p.id}', '${escapeHtml(p.cliente)}', ${p.montoEsperado})">Marcar pagado</button>
      </div>
    </div>
  `).join('');
}

/* ==========================================================
   INVENTARIO
   ========================================================== */

function renderInventario() {
  const wrap = document.getElementById('inventarioList');
  if (!STATE.inventario.length) {
    wrap.innerHTML = '<div class="empty-state">Agrega tipos de tamal en Config (pestaña "Config" de tu hoja) para poder llevar inventario.</div>';
    return;
  }
  wrap.innerHTML = STATE.inventario.map(inv => {
    const pct = inv.configurado && inv.cantidadInicial > 0
      ? Math.min(100, Math.round((inv.vendido / inv.cantidadInicial) * 100))
      : 0;
    return `
      <div class="inv-row" data-tipo="${escapeHtml(inv.tipo)}">
        <div class="inv-row-top">
          <span class="inv-tipo">${escapeHtml(inv.tipo)}</span>
          <span class="inv-vendido mono">Vendidos: ${inv.vendido}</span>
        </div>
        <div class="inv-row-main">
          <input type="number" class="inv-input" min="0"
                 value="${inv.configurado ? inv.cantidadInicial : ''}"
                 placeholder="Cantidad inicial">
          <span class="inv-disponible mono ${inv.configurado && inv.disponible === 0 ? 'inv-agotado' : ''}">
            ${inv.configurado ? 'Disponible: ' + inv.disponible : 'Sin límite'}
          </span>
        </div>
        <div class="inv-bar"><div class="inv-bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }).join('');
}

async function guardarInventario() {
  const items = [];
  document.querySelectorAll('.inv-row').forEach(row => {
    const tipo = row.dataset.tipo;
    const val = row.querySelector('.inv-input').value;
    if (val !== '') items.push({ tipo, cantidad: Number(val) });
  });
  const btn = document.getElementById('guardarInventarioBtn');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await apiPost('guardarInventario', { semana: STATE.semanaActual, items });
    await cargarTodo();
  } catch (err) {
    onError(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar inventario';
  }
}

/* ==========================================================
   MODAL
   ========================================================== */

function setupModal() {
  document.getElementById('modalCancelBtn').addEventListener('click', cerrarModal);
  document.getElementById('modalConfirmBtn').addEventListener('click', confirmarCobro);
}
let modalPedidoId = null;
function abrirModal(id, cliente, montoEsperado) {
  modalPedidoId = id;
  document.getElementById('modalClienteInfo').textContent = cliente + ' — monto esperado $' + Number(montoEsperado).toFixed(0);
  document.getElementById('montoCobradoInput').value = Number(montoEsperado).toFixed(0);
  document.getElementById('modalOverlay').classList.add('open');
}
function cerrarModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  modalPedidoId = null;
}
async function confirmarCobro() {
  const monto = Number(document.getElementById('montoCobradoInput').value || 0);
  const btn = document.getElementById('modalConfirmBtn');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await apiPost('completarPedido', { id: modalPedidoId, montoCobrado: monto });
    cerrarModal();
    await cargarTodo();
  } catch (err) {
    onError(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar cobro';
  }
}

/* ==========================================================
   DASHBOARD
   ========================================================== */

function renderDashboardStats() {
  const semanaActual = STATE.resumenSemanal.find(s => s.semana === STATE.semanaActual);
  document.getElementById('statSemanaActual').textContent = '$' + (semanaActual ? semanaActual.total.toFixed(0) : '0');
  document.getElementById('statCompletados').textContent = STATE.completados.length;
  document.getElementById('statPendientes').textContent = STATE.pendientes.length;
}

function drawChart() {
  const el = document.getElementById('chartGanancias');
  if (!el) return;
  if (!STATE.resumenSemanal.length) { el.innerHTML = '<div class="empty-state">Aún no hay ventas completadas para graficar.</div>'; return; }

  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('string', 'Semana');
  dataTable.addColumn('number', 'Ganancias');
  STATE.resumenSemanal.forEach(s => dataTable.addRow([s.label.replace('Semana ', 'S').replace(/ de .*/, ''), s.total]));

  const options = {
    backgroundColor: 'transparent',
    legend: { position: 'none' },
    colors: ['#E3A72B'],
    chartArea: { left: 60, top: 20, right: 20, bottom: 40, width: '100%', height: '75%' },
    hAxis: { textStyle: { color: '#2B2118', fontName: 'Inter' } },
    vAxis: { textStyle: { color: '#2B2118', fontName: 'Inter' }, format: '$#' },
    bar: { groupWidth: '55%' }
  };
  new google.visualization.ColumnChart(el).draw(dataTable, options);
}

/* ---------------- Cierre de la semana actual (widget en Ganancias) ---------------- */

function renderInvestCurrent() {
  const el = document.getElementById('investCardCurrent');
  const actual = STATE.resumenSemanal.find(s => s.semana === STATE.semanaActual);
  const gananciaBruta = actual ? actual.total : 0;

  if (actual && actual.registrada) {
    el.innerHTML = `
      <h3>Cierre de ${STATE.semanaActualLabel}</h3>
      <div class="invest-summary">
        <span>Ganancia bruta: <strong class="mono">$${gananciaBruta.toFixed(0)}</strong></span>
        <span>Inversión: <strong class="mono">$${actual.inversion.toFixed(0)}</strong></span>
        <span class="utilidad ${actual.utilidad >= 0 ? 'pos' : 'neg'}">Utilidad: <strong class="mono">$${actual.utilidad.toFixed(0)}</strong></span>
      </div>
      <div class="invest-actions">
        <button class="btn-ghost" onclick="cerrarSemanaActual()">Cerrar semana y reiniciar inventario</button>
      </div>
    `;
  } else {
    el.innerHTML = `
      <h3>Cierre de ${STATE.semanaActualLabel}</h3>
      <p class="invest-hint">Ganancia bruta hasta ahora: <strong class="mono">$${gananciaBruta.toFixed(0)}</strong>. Registra tu inversión para calcular la utilidad.</p>
      <div class="invest-form">
        <input type="number" class="invest-input" id="invest-input-current" placeholder="Inversión realizada" step="0.01">
        <button class="btn-primary" onclick="registrarInversion('${STATE.semanaActual}', 'current')">Registrar inversión</button>
      </div>
      <div class="invest-actions">
        <button class="btn-ghost" onclick="cerrarSemanaActual()">Cerrar semana y reiniciar inventario</button>
      </div>
    `;
  }
}

async function registrarInversion(semana, refId) {
  const input = document.getElementById('invest-input-' + refId);
  const inversion = Number(input.value);
  if (isNaN(inversion) || input.value === '') { alert('Escribe un monto de inversión'); return; }
  try {
    await apiPost('guardarInversion', { semana, inversion });
    await cargarTodo();
  } catch (err) {
    onError(err);
  }
}

async function cerrarSemanaActual() {
  const input = document.getElementById('invest-input-current');
  const inversion = input && input.value !== '' ? Number(input.value) : null;
  if (input && input.value !== '' && Number.isNaN(inversion)) {
    alert('El monto de inversión debe ser numérico');
    return;
  }
  const confirmar = window.confirm('¿Cerrar esta semana y empezar una nueva con el inventario en cero?');
  if (!confirmar) return;
  try {
    await apiPost('cerrarSemana', { semana: STATE.semanaActual, inversion });
    await cargarTodo();
  } catch (err) {
    onError(err);
  }
}

/* ==========================================================
   HISTORICO
   ========================================================== */

function renderHistorico() {
  const wrap = document.getElementById('historicoList');
  if (!STATE.resumenSemanal.length) {
    wrap.innerHTML = '<div class="empty-state">Todavía no hay semanas cerradas con ventas.</div>';
    return;
  }
  const semanas = [...STATE.resumenSemanal].sort((a, b) => b.semana.localeCompare(a.semana));
  wrap.innerHTML = semanas.map((s, i) => {
    const pedidosSemana = STATE.completados.filter(p => p.semana === s.semana);
    return `
      <div class="week-block">
        <div class="week-summary" onclick="toggleWeek(${i})">
          <div>
            <div class="week-title">${s.label}</div>
            <div class="week-meta">${s.pedidos} pedido${s.pedidos === 1 ? '' : 's'} completado${s.pedidos === 1 ? '' : 's'}</div>
          </div>
          <div class="week-summary-right">
            <div class="week-total mono">$${s.total.toFixed(0)}</div>
            ${s.registrada
              ? `<div class="utilidad-pill ${s.utilidad >= 0 ? 'pos' : 'neg'} mono">Utilidad $${s.utilidad.toFixed(0)}</div>`
              : `<div class="utilidad-pill pending mono">Sin cerrar</div>`}
          </div>
        </div>
        <div class="week-detail" id="week-detail-${i}">
          <div class="week-invest">
            ${s.registrada
              ? `<div class="invest-summary">
                   <span>Inversión: <strong class="mono">$${s.inversion.toFixed(0)}</strong></span>
                   <span class="utilidad ${s.utilidad >= 0 ? 'pos' : 'neg'}">Utilidad: <strong class="mono">$${s.utilidad.toFixed(0)}</strong></span>
                 </div>`
              : `<div class="invest-form">
                   <input type="number" class="invest-input" id="invest-input-${i}" placeholder="Inversión de la semana" step="0.01">
                   <button class="btn-ghost" onclick="registrarInversion('${s.semana}', ${i})">Registrar inversión</button>
                 </div>`}
          </div>
          ${pedidosSemana.map(p => `
            <div class="pedido-row">
              <div>
                <div class="p-cliente">${escapeHtml(p.cliente)}</div>
                <div class="p-detalle">${p.detalle.map(d => d.tipo + ' x' + d.cantidad).join(', ')}</div>
              </div>
              <div class="mono">$${Number(p.montoCobrado).toFixed(0)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function toggleWeek(i) {
  document.getElementById('week-detail-' + i).classList.toggle('open');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
