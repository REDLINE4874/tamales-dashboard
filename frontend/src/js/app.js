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
let appDialogResolver = null;
let toastTimer = null;

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
  setupAppDialog();
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
  showLoading("Conectando con tu negocio…", "Cargando pedidos e inventario.");
  try {
    setConnStatus("Sincronizando…");
    const data = await apiGet("dashboard");
    onDataLoaded(data);
    setConnStatus("Conectado", "ok");
  } catch (err) {
    onError(err);
    setConnStatus("Sin conexión con la API", "error");
  } finally {
    hideLoading();
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
  const dashLabel = document.getElementById("dashboardSemanaLabel"); if (dashLabel) dashLabel.textContent = (data.semanaActualLabel || "").toLowerCase();

  if (!document.querySelector("#itemsList .item-row")) addItemRow();
  else refreshItemRowOptions();

  renderPedidosActivos();
  renderInventario();
  renderDashboardStats();
  renderChartMonthFilter();
  renderInvestCurrent();
  renderHistorico();
  renderConfig();
  if (chartsReady) drawChart();
}

function onError(err) {
  console.error(err);
  return showAppDialog({
    title: "No se pudo completar",
    message: err && err.message ? err.message : String(err),
    confirmText: "Entendido",
  });
}

function setupAppDialog() {
  document
    .getElementById("appDialogConfirm")
    .addEventListener("click", () => closeAppDialog(true));
  document
    .getElementById("appDialogCancel")
    .addEventListener("click", () => closeAppDialog(false));
  document
    .getElementById("appDialogOverlay")
    .addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAppDialog(false);
    });
}

function showAppDialog({
  title,
  message,
  confirmText = "Aceptar",
  cancelText = "Cancelar",
  showCancel = false,
  danger = false,
}) {
  if (appDialogResolver) closeAppDialog(false);

  document.getElementById("appDialogTitle").textContent = title;
  document.getElementById("appDialogMessage").textContent = message;
  const cancelButton = document.getElementById("appDialogCancel");
  cancelButton.textContent = cancelText;
  cancelButton.hidden = !showCancel;

  const confirmButton = document.getElementById("appDialogConfirm");
  confirmButton.textContent = confirmText;
  confirmButton.classList.toggle("btn-danger", danger);

  const overlay = document.getElementById("appDialogOverlay");
  overlay.hidden = false;
  requestAnimationFrame(() => confirmButton.focus());

  return new Promise((resolve) => {
    appDialogResolver = resolve;
  });
}

function closeAppDialog(confirmed) {
  if (!appDialogResolver) return;
  document.getElementById("appDialogOverlay").hidden = true;
  const resolve = appDialogResolver;
  appDialogResolver = null;
  resolve(confirmed);
}

function showLoading(title, message) {
  document.getElementById("loadingTitle").textContent = title;
  document.getElementById("loadingMessage").textContent = message;
  document.getElementById("loadingOverlay").hidden = false;
}

function hideLoading() {
  document.getElementById("loadingOverlay").hidden = true;
}

function showToast(message) {
  const toast = document.getElementById("appToast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3500);
}

function actionFeedback(action) {
  const messages = {
    crearPedido: ["Creando el pedido…", "Guardando la comanda y reservando el inventario.", "Pedido creado y guardado."],
    editarPedido: ["Guardando cambios…", "Actualizando el pedido y revisando el inventario.", "Cambios del pedido guardados."],
    completarPedido: ["Registrando el pago…", "Actualizando el estado y las ganancias.", "Pago registrado correctamente."],
    eliminarPedido: ["Eliminando pedido…", "Actualizando el inventario disponible.", "Pedido eliminado."],
    guardarInventario: ["Guardando inventario…", "Actualizando las cantidades disponibles.", "Inventario guardado."],
    guardarInversion: ["Guardando inversión…", "Actualizando el cierre de la semana.", "Inversión guardada."],
    cerrarSemana: ["Cerrando la semana…", "Guardando el cierre y preparando la siguiente semana.", "Semana cerrada correctamente."],
    guardarConfig: ["Guardando configuración…", "Actualizando los tipos y precios.", "Configuración guardada."],
  };
  return messages[action] || ["Guardando…", "Actualizando la información.", "Cambios guardados."];
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
  const [loadingTitle, loadingMessage, successMessage] = actionFeedback(action);
  showLoading(loadingTitle, loadingMessage);
  setConnStatus("Sincronizando…");
  try {
    const data = await apiPost(action, payload);
    onDataLoaded(data);
    setConnStatus("Conectado", "ok");
    showToast(successMessage);
    return data;
  } catch (err) {
    setConnStatus("Sin conexión con la API", "error");
    throw err;
  } finally {
    hideLoading();
  }
}
