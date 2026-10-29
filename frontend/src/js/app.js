/* ==========================================================
   ESTADO Y ARRANQUE
   ========================================================== */

const APP_FONT_URL =
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap";

function installAppFonts() {
  document.querySelectorAll('link[href*="fonts.googleapis.com"]').forEach((link) => {
    if (link.href !== APP_FONT_URL) link.remove();
  });
  if (!document.querySelector(`link[href="${APP_FONT_URL}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = APP_FONT_URL;
    document.head.appendChild(link);
  }
}

function iconSvg(path, className = "") {
  return `<svg class="${className}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}" /></svg>`;
}

function installSvgIcons() {
  const brandIcon = document.querySelector(".brand-mark");
  if (brandIcon) {
    brandIcon.innerHTML = iconSvg("M4 10.5 12 4l8 6.5v7.2a1.3 1.3 0 0 1-1.3 1.3H5.3A1.3 1.3 0 0 1 4 17.7z M8 19v-5h8v5 M8 10h.01 M12 10h.01 M16 10h.01", "brand-svg");
  }
  document.querySelectorAll(".site-auth-logo").forEach((logo) => {
    logo.innerHTML = iconSvg("M4 10.5 12 4l8 6.5v7.2a1.3 1.3 0 0 1-1.3 1.3H5.3A1.3 1.3 0 0 1 4 17.7z M8 19v-5h8v5 M8 10h.01 M12 10h.01 M16 10h.01", "auth-logo-svg");
  });
  document.querySelectorAll(".group-icon").forEach((icon) => {
    icon.textContent = "";
    icon.appendChild(document.createRange().createContextualFragment(iconSvg("M20 21a8 8 0 0 0-16 0 M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8")));
  });
  document.querySelectorAll(".btn-plus").forEach((button) => { button.innerHTML = iconSvg("M12 5v14 M5 12h14"); });
  document.querySelectorAll(".btn-minus").forEach((button) => { button.innerHTML = iconSvg("M5 12h14"); });
  document.querySelectorAll(".add-icon").forEach((icon) => { icon.innerHTML = iconSvg("M12 5v14 M5 12h14"); });
  document.querySelectorAll(".btn-arrow").forEach((arrow) => { arrow.innerHTML = iconSvg("M5 12h14 M13 6l6 6-6 6"); });
  document.querySelectorAll(".item-remove-btn span").forEach((remove) => {
    remove.innerHTML = iconSvg("M6 6l12 12 M18 6 6 18", "remove-svg");
  });
}

installAppFonts();
installSvgIcons();

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

function initApp() {
  installSvgIcons();
  setupNav();
  setupAppDialog();
  setupForm();
  setupModal();
  const btnGuardarInv = document.getElementById("guardarInventarioBtn");
  if (btnGuardarInv) {
    btnGuardarInv.addEventListener("click", guardarInventario);
  }
  setupConfig();

  // Si ya hay sesión en Supabase, cargar datos
  if (window.SUPABASE_AUTH_CLIENT?.auth) {
    window.SUPABASE_AUTH_CLIENT.auth.getSession().then(({ data }) => {
      if (data?.session) {
        cargarTodo();
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

function setConnStatus(text, cls) {
  const el = document.getElementById("connStatus");
  if (!el) return;
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
      const targetView = document.getElementById("view-" + btn.dataset.view);
      if (targetView) {
        targetView.classList.add("active");
      }
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
  if (!data) return;
  STATE.config = data.config || { tipos: [] };
  STATE.pendientes = data.pendientes || [];
  STATE.completados = data.completados || [];
  STATE.resumenSemanal = data.resumenSemanal || [];
  STATE.inventario = data.inventario || [];
  STATE.semanaActual = data.semanaActual || "";
  STATE.semanaActualLabel = data.semanaActualLabel || "";

  const weekChip = document.getElementById("currentWeekChip");
  if (weekChip) weekChip.textContent = data.semanaActualLabel;

  const invLabel = document.getElementById("inventarioSemanaLabel");
  if (invLabel) invLabel.textContent = data.semanaActualLabel;

  const dashLabel = document.getElementById("dashboardSemanaLabel");
  if (dashLabel) dashLabel.textContent = (data.semanaActualLabel || "").toLowerCase();

  if (!document.querySelector("#itemsList .item-row")) addItemRow();
  else refreshItemRowOptions();

  renderPedidosActivos();
  renderInventario();
  renderDashboardStats();
  renderChartMonthFilter();
  renderInvestCurrent();
  renderHistorico();
  renderConfig();
  // La respuesta del guardado trae el inventario actualizado. Revalidar
  // explícitamente el pedido también cubre el caso en que el warning estaba
  // visible antes de guardar el stock.
  refreshFormState();
  installSvgIcons();
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
  const confirmBtn = document.getElementById("appDialogConfirm");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => closeAppDialog(true));
  }
  const cancelBtn = document.getElementById("appDialogCancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => closeAppDialog(false));
  }
  const overlay = document.getElementById("appDialogOverlay");
  if (overlay) {
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAppDialog(false);
    });
  }
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

  const titleEl = document.getElementById("appDialogTitle");
  if (titleEl) titleEl.textContent = title;
  const msgEl = document.getElementById("appDialogMessage");
  if (msgEl) msgEl.textContent = message;

  const cancelButton = document.getElementById("appDialogCancel");
  if (cancelButton) {
    cancelButton.textContent = cancelText;
    cancelButton.hidden = !showCancel;
  }

  const confirmButton = document.getElementById("appDialogConfirm");
  if (confirmButton) {
    confirmButton.textContent = confirmText;
    confirmButton.classList.toggle("btn-danger", danger);
  }

  const overlay = document.getElementById("appDialogOverlay");
  if (overlay) {
    overlay.hidden = false;
    requestAnimationFrame(() => confirmButton?.focus());
  }

  return new Promise((resolve) => {
    appDialogResolver = resolve;
  });
}

function closeAppDialog(confirmed) {
  if (!appDialogResolver) return;
  const overlay = document.getElementById("appDialogOverlay");
  if (overlay) overlay.hidden = true;
  const resolve = appDialogResolver;
  appDialogResolver = null;
  resolve(confirmed);
}

function showLoading(title, message) {
  const titleEl = document.getElementById("loadingTitle");
  if (titleEl) titleEl.textContent = title;
  const msgEl = document.getElementById("loadingMessage");
  if (msgEl) msgEl.textContent = message;
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.hidden = false;
}

function hideLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.hidden = true;
}

function showToast(message) {
  const toast = document.getElementById("appToast");
  if (!toast) return;
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
    setConnStatus("Error al sincronizar", "error");
    throw err;
  } finally {
    hideLoading();
  }
}
