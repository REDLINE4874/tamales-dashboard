/* ==========================================================
   ESTADO Y ARRANQUE
   ========================================================== */

let STATE = {
  config: { tipos: [] }, // tipos: [{ tipo, precio }, ...]
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
  setupConfig();
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

  if (!document.querySelector("#itemsList .item-row")) addItemRow();
  else refreshItemRowOptions();

  renderPedidosActivos();
  renderInventario();
  renderDashboardStats();
  renderInvestCurrent();
  renderHistorico();
  renderConfig();
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

