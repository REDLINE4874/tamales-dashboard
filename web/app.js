/* ==========================================================
   API — llamadas a la URL de implementación de Apps Script
   vía JSONP (etiqueta <script>), para evitar por completo el
   bloqueo de CORS que Apps Script no resuelve con fetch().
   ========================================================== */

function jsonpRequest(action, params = {}, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const callbackName =
      "tamalesCb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
    const script = document.createElement("script");
    let settled = false;
    let timer = null;

    const cleanup = () => {
      delete window[callbackName];
      script.remove();
      if (timer) clearTimeout(timer);
    };

    // Evita que una respuesta tardía (o duplicada) se procese dos veces,
    // y evita que la UI se quede colgada indefinidamente en "Creando…".
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          "La API tardó demasiado en responder. Revisa tu conexión e inténtalo de nuevo.",
        ),
      );
    }, timeoutMs);

    window[callbackName] = (response) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (response && response.ok) resolve(response.data);
      else
        reject(new Error((response && response.error) || "Error desconocido"));
    };

    const url = new URL(API_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callbackName);
    Object.entries(params).forEach(([k, v]) => {
      if (v == null) return;
      url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : v);
    });

    script.src = url.toString();
    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("No se pudo conectar con la API"));
    };
    document.body.appendChild(script);
  });
}

function apiGet(action, params = {}) {
  return jsonpRequest(action, params);
}
function apiPost(action, payload = {}) {
  return jsonpRequest(action, payload);
}

/* ==========================================================
   ESTADO Y ARRANQUE
   ========================================================== */

let STATE = {
  config: { precio: 0, tipos: [] },
  pendientes: [],
  completados: [],
  resumenSemanal: [],
  inventario: [],
  semanaActual: "",
  semanaActualLabel: "",
};
let chartsReady = false;

// Estado del formulario de "Nuevo pedido" / edición
let creatingPedido = false;
let editingPedidoId = null;
let editingOriginalItems = null; // detalle original del pedido que se está editando

google.charts.load("current", { packages: ["corechart"] });
google.charts.setOnLoadCallback(() => {
  chartsReady = true;
  if (STATE.resumenSemanal.length) drawChart();
});

document.addEventListener("DOMContentLoaded", () => {
  if (!API_URL || API_URL.includes("PEGA_AQUI")) {
    setConnStatus("Falta configurar API_URL en config.js", "error");
  }
  setupNav();
  setupForm();
  setupModal();
  document
    .getElementById("guardarInventarioBtn")
    .addEventListener("click", guardarInventario);
  cargarTodo();
});

function setConnStatus(text, cls) {
  const el = document.getElementById("connStatus");
  el.textContent = text;
  el.className = "conn-status" + (cls ? " " + cls : "");
}

function setupNav() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".nav-item")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelectorAll(".view")
        .forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      document
        .getElementById("view-" + btn.dataset.view)
        .classList.add("active");
    });
  });
}

async function cargarTodo() {
  try {
    setConnStatus("Sincronizando…");
    const data = await apiGet("dashboard");
    onDataLoaded(data);
    setConnStatus("Conectado", "ok");
  } catch (err) {
    onError(err);
    setConnStatus("Sin conexión con la API", "error");
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

  document.getElementById("currentWeekChip").textContent =
    data.semanaActualLabel;
  document.getElementById("inventarioSemanaLabel").textContent =
    data.semanaActualLabel;
  document.getElementById("dashboardSemanaLabel").textContent =
    data.semanaActualLabel.toLowerCase();

  if (!document.querySelector(".item-row")) addItemRow();
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
  alert("Ocurrió un error: " + (err && err.message ? err.message : err));
}

/**
 * Envía una acción de escritura (crear/editar/eliminar pedido, guardar
 * inventario, etc.) y refresca la UI con la MISMA respuesta del POST, en
 * vez de hacer una segunda petición completa a "dashboard". El backend ya
 * devuelve el dashboard actualizado en cada acción de escritura, así que
 * esto le ahorra al usuario una ida y vuelta entera al servidor (que en
 * Apps Script/JSONP es lo que más tarda).
 */
async function postAndSync(action, payload) {
  setConnStatus("Sincronizando…");
  try {
    const data = await apiPost(action, payload);
    onDataLoaded(data);
    setConnStatus("Conectado", "ok");
    return data;
  } catch (err) {
    setConnStatus("Sin conexión con la API", "error");
    throw err;
  }
}

/* ==========================================================
   NUEVO PEDIDO / EDICIÓN DE PEDIDO
   ========================================================== */

function addItemRow(presetTipo, presetCantidad) {
  const list = document.getElementById("itemsList");
  const row = document.createElement("div");
  row.className = "item-row";

  row.innerHTML = `
    <div class="item-row-main">
      <select class="item-tipo">${optionsHTML()}</select>
      <div class="cant-control">
        <button type="button" class="btn-minus">−</button>
        <input type="number" class="item-cant" min="1" value="${presetCantidad || 1}" placeholder="Cant.">
        <button type="button" class="btn-plus">+</button>
      </div>
      <button type="button" class="remove-item">✕</button>
    </div>
    <div class="item-hint"></div>
  `;

  if (presetTipo) {
    const sel = row.querySelector(".item-tipo");
    if ([...sel.options].some((o) => o.value === presetTipo)) {
      sel.value = presetTipo;
    }
  }

  row.querySelector(".remove-item").addEventListener("click", () => {
    row.remove();
    refreshFormState();
  });
  const input = row.querySelector(".item-cant");
  input.addEventListener("input", refreshFormState);
  row.querySelector(".item-tipo").addEventListener("change", refreshFormState);

  row.querySelector(".btn-minus").addEventListener("click", () => {
    input.value = Math.max(1, Number(input.value) - 1);
    refreshFormState();
  });

  row.querySelector(".btn-plus").addEventListener("click", () => {
    input.value = Number(input.value) + 1;
    refreshFormState();
  });

  list.appendChild(row);
  refreshFormState();
}

function optionsHTML() {
  return (STATE.config.tipos || [])
    .map((t) => `<option value="${t}">${t}</option>`)
    .join("");
}

function refreshItemRowOptions() {
  document.querySelectorAll(".item-tipo").forEach((sel) => {
    const current = sel.value;
    sel.innerHTML = optionsHTML();
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  });
  refreshFormState();
}

/** Recalcula total, valida disponibilidad de inventario por renglón y
 *  habilita/deshabilita el botón de crear/guardar comanda.
 *  Si se está editando un pedido existente, se le "devuelven" al
 *  inventario disponible las cantidades que ese pedido ya tenía
 *  reservadas, para no marcar falso excedente sobre sí mismo. */
function refreshFormState() {
  let cantidadTotal = 0;
  let hayExcedente = false;

  document.querySelectorAll(".item-row").forEach((row) => {
    const tipo = row.querySelector(".item-tipo").value;
    const cantidad = Number(row.querySelector(".item-cant").value || 0);
    cantidadTotal += cantidad;

    const hint = row.querySelector(".item-hint");
    const inv = (STATE.inventario || []).find((i) => i.tipo === tipo);

    let disponibleAjustado = inv ? inv.disponible : 0;
    if (editingOriginalItems && inv && inv.configurado) {
      const reservadoOriginal = editingOriginalItems
        .filter((d) => d.tipo === tipo)
        .reduce((sum, d) => sum + d.cantidad, 0);
      disponibleAjustado = inv.disponible + reservadoOriginal;
    }

    if (!inv || !inv.configurado) {
      hint.textContent = "Sin límite configurado";
      hint.className = "item-hint";
    } else if (cantidad > disponibleAjustado) {
      hint.textContent = `Solo quedan ${disponibleAjustado} disponibles de ${tipo}`;
      hint.className = "item-hint item-hint-error";
      hayExcedente = true;
    } else {
      hint.textContent = `Disponible: ${disponibleAjustado}`;
      hint.className = "item-hint";
    }
  });

  const total = cantidadTotal * (STATE.config.precio || 0);
  document.getElementById("totalEstimado").textContent = "$" + total.toFixed(0);

  const warning = document.getElementById("pedidoWarning");
  const btn = document.getElementById("crearPedidoBtn");
  if (hayExcedente) {
    warning.hidden = false;
    warning.textContent =
      "Ajusta las cantidades: no hay suficiente inventario para completar este pedido.";
    btn.disabled = true;
  } else {
    warning.hidden = true;
    btn.disabled = false;
  }
}

function setupForm() {
  document.getElementById("addItemBtn").addEventListener("click", () => addItemRow());
  document
    .getElementById("crearPedidoBtn")
    .addEventListener("click", guardarPedido);
  document
    .getElementById("cancelEditBtn")
    .addEventListener("click", cancelarEdicion);
}

async function guardarPedido() {
  // Guardia extra contra doble clic / doble tap, independiente de btn.disabled
  if (creatingPedido) return;

  const cliente = document.getElementById("clienteInput").value.trim();
  if (!cliente) {
    alert("Escribe el nombre del cliente");
    return;
  }

  const items = [];
  document.querySelectorAll(".item-row").forEach((r) => {
    const tipo = r.querySelector(".item-tipo").value;
    const cantidad = Number(r.querySelector(".item-cant").value || 0);
    if (cantidad > 0) items.push({ tipo, cantidad });
  });
  if (!items.length) {
    alert("Agrega al menos un tamal");
    return;
  }

  creatingPedido = true;
  const btn = document.getElementById("crearPedidoBtn");
  const btnLabel = btn.querySelector("span");
  const originalLabel = btnLabel.textContent;
  btn.disabled = true;
  btnLabel.textContent = editingPedidoId ? "Guardando…" : "Creando…";

  try {
    if (editingPedidoId) {
      await postAndSync("editarPedido", { id: editingPedidoId, cliente, items });
    } else {
      // Id único por intento: úsalo en Apps Script (LockService + caché) para
      // descartar una segunda ejecución si el mismo request llega duplicado.
      const clientRequestId =
        window.crypto && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await postAndSync("crearPedido", { cliente, items, clientRequestId });
    }
    cancelarEdicion();
    document.querySelector('.nav-item[data-view="activos"]').click();
  } catch (err) {
    onError(err);
    btnLabel.textContent = originalLabel;
  } finally {
    creatingPedido = false;
    btn.disabled = false;
  }
}

/** Abre el formulario de "Nuevo pedido" en modo edición, precargado
 *  con los datos de un pedido pendiente existente. */
function abrirEdicionPedido(id) {
  const pedido = STATE.pendientes.find((p) => p.id === id);
  if (!pedido) return;

  editingPedidoId = pedido.id;
  editingOriginalItems = pedido.detalle.map((d) => ({
    tipo: d.tipo,
    cantidad: d.cantidad,
  }));

  document.getElementById("clienteInput").value = pedido.cliente;
  document.getElementById("itemsList").innerHTML = "";
  pedido.detalle.forEach((d) => addItemRow(d.tipo, d.cantidad));

  document.getElementById("formTitle").textContent = "Editar comanda";
  document.getElementById("crearPedidoBtn").querySelector("span").textContent =
    "Guardar cambios";
  document.getElementById("editBannerCliente").textContent = pedido.cliente;
  document.getElementById("editBanner").hidden = false;

  document.querySelector('.nav-item[data-view="nuevo"]').click();
  refreshFormState();
}

/** Sale del modo edición y deja el formulario listo para un pedido nuevo. */
function cancelarEdicion() {
  editingPedidoId = null;
  editingOriginalItems = null;

  document.getElementById("clienteInput").value = "";
  document.getElementById("itemsList").innerHTML = "";
  addItemRow();

  document.getElementById("formTitle").textContent = "Nueva comanda";
  document.getElementById("crearPedidoBtn").querySelector("span").textContent =
    "Crear comanda";
  document.getElementById("editBanner").hidden = true;

  refreshFormState();
}

/* ==========================================================
   PEDIDOS ACTIVOS
   ========================================================== */

function renderPedidosActivos() {
  const wrap = document.getElementById("pedidosActivosList");
  if (!STATE.pendientes.length) {
    wrap.innerHTML =
      '<div class="empty-state">No hay comandas pendientes. Crea una desde “Nuevo pedido”.</div>';
    return;
  }
  wrap.innerHTML = STATE.pendientes
    .map(
      (p) => `
    <div class="ticket">
      <div class="ticket-head">
        <span class="ticket-cliente">${escapeHtml(p.cliente)}</span>
        <span class="ticket-badge">Pendiente</span>
      </div>
      <ul class="ticket-detalle">
        ${p.detalle.map((d) => `<li><span>${escapeHtml(d.tipo)}</span><span>x${d.cantidad}</span></li>`).join("")}
      </ul>
      <div class="ticket-foot">
        <span class="ticket-total mono">$${Number(p.montoEsperado).toFixed(0)}</span>
      </div>
      <div class="ticket-actions">
        <button class="ticket-edit-btn" onclick="abrirEdicionPedido('${p.id}')">Editar</button>
        <button class="ticket-delete-btn" onclick="eliminarPedido('${p.id}')">Eliminar</button>
        <button class="ticket-complete-btn" onclick="abrirModal('${p.id}', '${escapeHtml(p.cliente)}', ${p.montoEsperado})">Marcar pagado</button>
      </div>
    </div>
  `,
    )
    .join("");
}

/** Elimina un pedido pendiente. El backend debe devolver sus tamales
 *  al inventario disponible de la semana correspondiente. */
async function eliminarPedido(id) {
  const pedido = STATE.pendientes.find((p) => p.id === id);
  const nombre = pedido ? pedido.cliente : "este pedido";
  const confirmar = window.confirm(
    `¿Eliminar la comanda de ${nombre}? Los tamales regresarán al inventario disponible.`,
  );
  if (!confirmar) return;

  try {
    await postAndSync("eliminarPedido", { id });
    if (editingPedidoId === id) cancelarEdicion();
  } catch (err) {
    onError(err);
  }
}

/* ==========================================================
   INVENTARIO
   ========================================================== */

function renderInventario() {
  const wrap = document.getElementById("inventarioList");
  if (!STATE.inventario.length) {
    wrap.innerHTML =
      '<div class="empty-state">Agrega tipos de tamal en Config (pestaña "Config" de tu hoja) para poder llevar inventario.</div>';
    return;
  }
  wrap.innerHTML = STATE.inventario
    .map((inv) => {
      const pct =
        inv.configurado && inv.cantidadInicial > 0
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
                 value="${inv.configurado ? inv.cantidadInicial : ""}"
                 placeholder="Cantidad inicial">
          <span class="inv-disponible mono ${inv.configurado && inv.disponible === 0 ? "inv-agotado" : ""}">
            ${inv.configurado ? "Disponible: " + inv.disponible : "Sin límite"}
          </span>
        </div>
        <div class="inv-bar"><div class="inv-bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
    })
    .join("");
}

async function guardarInventario() {
  const items = [];
  document.querySelectorAll(".inv-row").forEach((row) => {
    const tipo = row.dataset.tipo;
    const val = row.querySelector(".inv-input").value;
    if (val !== "") items.push({ tipo, cantidad: Number(val) });
  });
  const btn = document.getElementById("guardarInventarioBtn");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await postAndSync("guardarInventario", { semana: STATE.semanaActual, items });
  } catch (err) {
    onError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar inventario";
  }
}

/* ==========================================================
   MODAL
   ========================================================== */

function setupModal() {
  document
    .getElementById("modalCancelBtn")
    .addEventListener("click", cerrarModal);
  document
    .getElementById("modalConfirmBtn")
    .addEventListener("click", confirmarCobro);
}
let modalPedidoId = null;
function abrirModal(id, cliente, montoEsperado) {
  modalPedidoId = id;
  document.getElementById("modalClienteInfo").textContent =
    cliente + " — monto esperado $" + Number(montoEsperado).toFixed(0);
  document.getElementById("montoCobradoInput").value =
    Number(montoEsperado).toFixed(0);
  document.getElementById("modalOverlay").classList.add("open");
}
function cerrarModal() {
  document.getElementById("modalOverlay").classList.remove("open");
  modalPedidoId = null;
}
async function confirmarCobro() {
  const monto = Number(document.getElementById("montoCobradoInput").value || 0);
  const btn = document.getElementById("modalConfirmBtn");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await postAndSync("completarPedido", {
      id: modalPedidoId,
      montoCobrado: monto,
    });
    cerrarModal();
  } catch (err) {
    onError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirmar cobro";
  }
}

/* ==========================================================
   DASHBOARD
   ========================================================== */

function renderDashboardStats() {
  const semanaActual = STATE.resumenSemanal.find(
    (s) => s.semana === STATE.semanaActual,
  );
  document.getElementById("statSemanaActual").textContent =
    "$" + (semanaActual ? semanaActual.total.toFixed(0) : "0");
  document.getElementById("statCompletados").textContent =
    STATE.completados.length;
  document.getElementById("statPendientes").textContent =
    STATE.pendientes.length;
}

function drawChart() {
  const el = document.getElementById("chartGanancias");
  if (!el) return;
  if (!STATE.resumenSemanal.length) {
    el.innerHTML =
      '<div class="empty-state">Aún no hay ventas completadas para graficar.</div>';
    return;
  }

  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn("string", "Semana");
  dataTable.addColumn("number", "Ganancias");
  STATE.resumenSemanal.forEach((s) =>
    dataTable.addRow([
      s.label.replace("Semana ", "S").replace(/ de .*/, ""),
      s.total,
    ]),
  );

  const isMobile = window.innerWidth < 480;
  const fontSize = isMobile ? 10 : 12;

  const options = {
    backgroundColor: "transparent",
    legend: { position: "none" },
    colors: ["#E3A72B"],
    chartArea: {
      // Márgenes proporcionales en vez de píxeles fijos: en pantallas
      // angostas "left: 60" dejaba las barras apretadas contra el eje.
      left: isMobile ? "18%" : "12%",
      top: 20,
      right: 14,
      bottom: isMobile ? 30 : 40,
      width: isMobile ? "78%" : "85%",
      height: isMobile ? "68%" : "75%",
    },
    hAxis: {
      textStyle: { color: "#2B2118", fontName: "Inter", fontSize },
    },
    vAxis: {
      textStyle: { color: "#2B2118", fontName: "Inter", fontSize },
      format: "$#",
    },
    bar: { groupWidth: "55%" },
  };
  new google.visualization.ColumnChart(el).draw(dataTable, options);
}

// El contenedor de "Ganancias" está oculto (display:none) hasta que el
// usuario entra a esa pestaña. Si el gráfico se dibuja mientras está
// oculto, Google Charts lo mide con ancho 0 y queda deformado. Por eso
// lo volvemos a dibujar cada vez que se activa la pestaña, y al cambiar
// el tamaño de la ventana (p. ej. al rotar el celular).
document.addEventListener("DOMContentLoaded", () => {
  document
    .querySelector('.nav-item[data-view="dashboard"]')
    ?.addEventListener("click", () => {
      if (chartsReady && STATE.resumenSemanal.length) drawChart();
    });
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const view = document.getElementById("view-dashboard");
    if (chartsReady && view?.classList.contains("active") && STATE.resumenSemanal.length) {
      drawChart();
    }
  }, 200);
});

/* ---------------- Cierre de la semana actual (widget en Ganancias) ---------------- */

function renderInvestCurrent() {
  const el = document.getElementById("investCardCurrent");
  const actual = STATE.resumenSemanal.find(
    (s) => s.semana === STATE.semanaActual,
  );
  const gananciaBruta = actual ? actual.total : 0;

  if (actual && actual.registrada) {
    el.innerHTML = `
      <h3>Cierre de ${STATE.semanaActualLabel}</h3>
      <div class="invest-summary">
        <span>Ganancia bruta: <strong class="mono">$${gananciaBruta.toFixed(0)}</strong></span>
        <span>Inversión: <strong class="mono">$${actual.inversion.toFixed(0)}</strong></span>
        <span class="utilidad ${actual.utilidad >= 0 ? "pos" : "neg"}">Utilidad: <strong class="mono">$${actual.utilidad.toFixed(0)}</strong></span>
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
  const input = document.getElementById("invest-input-" + refId);
  const inversion = Number(input.value);
  if (isNaN(inversion) || input.value === "") {
    alert("Escribe un monto de inversión");
    return;
  }
  try {
    await postAndSync("guardarInversion", { semana, inversion });
  } catch (err) {
    onError(err);
  }
}

async function cerrarSemanaActual() {
  const input = document.getElementById("invest-input-current");
  const inversion = input && input.value !== "" ? Number(input.value) : null;
  if (input && input.value !== "" && Number.isNaN(inversion)) {
    alert("El monto de inversión debe ser numérico");
    return;
  }
  const confirmar = window.confirm(
    "¿Cerrar esta semana y empezar una nueva con el inventario en cero?",
  );
  if (!confirmar) return;
  try {
    await postAndSync("cerrarSemana", { semana: STATE.semanaActual, inversion });
  } catch (err) {
    onError(err);
  }
}

/* ==========================================================
   HISTORICO
   ========================================================== */

function renderHistorico() {
  const wrap = document.getElementById("historicoList");
  if (!STATE.resumenSemanal.length) {
    wrap.innerHTML =
      '<div class="empty-state">Todavía no hay semanas cerradas con ventas.</div>';
    return;
  }
  const semanas = [...STATE.resumenSemanal].sort((a, b) =>
    b.semana.localeCompare(a.semana),
  );
  wrap.innerHTML = semanas
    .map((s, i) => {
      const pedidosSemana = STATE.completados.filter(
        (p) => p.semana === s.semana,
      );
      return `
      <div class="week-block">
        <div class="week-summary" onclick="toggleWeek(${i})">
          <div>
            <div class="week-title">${s.label}</div>
            <div class="week-meta">${s.pedidos} pedido${s.pedidos === 1 ? "" : "s"} completado${s.pedidos === 1 ? "" : "s"}</div>
          </div>
          <div class="week-summary-right">
            <div class="week-total mono">$${s.total.toFixed(0)}</div>
            ${
              s.registrada
                ? `<div class="utilidad-pill ${s.utilidad >= 0 ? "pos" : "neg"} mono">Utilidad $${s.utilidad.toFixed(0)}</div>`
                : `<div class="utilidad-pill pending mono">Sin cerrar</div>`
            }
          </div>
        </div>
        <div class="week-detail" id="week-detail-${i}">
          <div class="week-invest">
            ${
              s.registrada
                ? `<div class="invest-summary">
                   <span>Inversión: <strong class="mono">$${s.inversion.toFixed(0)}</strong></span>
                   <span class="utilidad ${s.utilidad >= 0 ? "pos" : "neg"}">Utilidad: <strong class="mono">$${s.utilidad.toFixed(0)}</strong></span>
                 </div>`
                : `<div class="invest-form">
                   <input type="number" class="invest-input" id="invest-input-${i}" placeholder="Inversión de la semana" step="0.01">
                   <button class="btn-ghost" onclick="registrarInversion('${s.semana}', ${i})">Registrar inversión</button>
                 </div>`
            }
          </div>
          ${pedidosSemana
            .map(
              (p) => `
            <div class="pedido-row">
              <div>
                <div class="p-cliente">${escapeHtml(p.cliente)}</div>
                <div class="p-detalle">${p.detalle.map((d) => d.tipo + " x" + d.cantidad).join(", ")}</div>
              </div>
              <div class="mono">$${Number(p.montoCobrado).toFixed(0)}</div>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    `;
    })
    .join("");
}

function toggleWeek(i) {
  document.getElementById("week-detail-" + i).classList.toggle("open");
}

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}