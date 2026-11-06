/* ==========================================================
   ESTADO Y ARRANQUE
   ========================================================== */

const APP_FONT_URL =
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap";

function installAppFonts() {
  document.querySelectorAll('link[href*="fonts.googleapis.com"]').forEach((link) => {
    if (link.href !== APP_FONT_URL && !link.href.includes("Material+Symbols")) link.remove();
  });
  if (!document.querySelector(`link[href="${APP_FONT_URL}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = APP_FONT_URL;
    document.head.appendChild(link);
  }
}

function iconSvg(path, className = "") {
  const iconNames = {
    "M4 10.5 12 4l8 6.5v7.2a1.3 1.3 0 0 1-1.3 1.3H5.3A1.3 1.3 0 0 1 4 17.7z M8 19v-5h8v5 M8 10h.01 M12 10h.01 M16 10h.01": "storefront",
    "M20 21a8 8 0 0 0-16 0 M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8": "person",
    "M12 5v14 M5 12h14": "add",
    "M5 12h14": "remove",
    "M5 12h14 M13 6l6 6-6 6": "arrow_forward",
    "M6 6l12 12 M18 6 6 18": "close",
  };
  const iconName = iconNames[path] || "circle";
  return `<span class="material-symbols-rounded ${className}" aria-hidden="true">${iconName}</span>`;
}

function installSvgIcons() {
  const brandIcon = document.querySelector(".brand-mark");
  if (brandIcon) {
    brandIcon.innerHTML = '<img class="brand-svg" src="icons/logo.svg" alt="" aria-hidden="true">';
  }
  document.querySelectorAll(".site-auth-logo").forEach((logo) => {
    logo.innerHTML = '<img class="auth-logo-svg" src="icons/logo.svg" alt="" aria-hidden="true">';
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
    remove.innerHTML =
      '<svg class="remove-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
  });
}

installAppFonts();
installSvgIcons();

let STATE = {
  config: { tipos: [], bebidas: [] }, // catalogo de tamales y bebidas
  pendientes: [],
  completados: [],
  resumenSemanal: [],
  inventario: [],
  semanaActual: "",
  semanaActualLabel: "",
  fechaOperativa: "",
  fechaOperativaLabel: "",
  pedidosTamalesAbiertos: false,
  pedidosBebidasAbiertos: false,
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
  const btnCerrarInventarios = document.getElementById("cerrarInventariosAnterioresBtn");
  if (btnCerrarInventarios) {
    btnCerrarInventarios.addEventListener("click", async () => {
      const confirmar = await showAppDialog({
        title: "Cerrar inventarios anteriores",
        message: "Se cerrarán los registros de inventario con fecha anterior a hoy. Se conserva el historial de pedidos y el inventario de hoy no cambia.",
        confirmText: "Cerrar anteriores",
        showCancel: true,
      });
      if (!confirmar) return;
      try {
        const cerrados = await postAndSync("cerrarInventariosAnteriores");
        showToast(cerrados ? `Se cerraron ${cerrados} registros de inventario anteriores.` : "No había inventarios anteriores abiertos.");
      } catch (err) {
        onError(err);
      }
    });
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
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
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
  STATE.config = data.config || { tipos: [], bebidas: [] };
  STATE.pendientes = data.pendientes || [];
  STATE.completados = data.completados || [];
  STATE.resumenSemanal = data.resumenSemanal || [];
  STATE.inventario = data.inventario || [];
  STATE.semanaActual = data.semanaActual || "";
  STATE.semanaActualLabel = data.semanaActualLabel || "";
  STATE.fechaOperativa = data.fechaOperativa || "";
  STATE.fechaOperativaLabel = data.fechaOperativaLabel || "";
  STATE.pedidosTamalesAbiertos = Boolean(data.pedidosTamalesAbiertos);
  STATE.pedidosBebidasAbiertos = Boolean(data.pedidosBebidasAbiertos);

  const weekChip = document.getElementById("currentWeekChip");
  if (weekChip) {
    const weekNumber = STATE.semanaActualLabel.match(/Semana\s+(\d+)/i)?.[1];
    weekChip.textContent = weekNumber ? `Semana ${weekNumber}` : STATE.semanaActualLabel;
    weekChip.title = STATE.semanaActualLabel;
    weekChip.setAttribute("aria-label", STATE.semanaActualLabel);
  }

  const invLabel = document.getElementById("inventarioDiaLabel");
  if (invLabel) invLabel.textContent = data.fechaOperativaLabel || "hoy";

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
    eliminarPedido: ["Cancelando pedido…", "Actualizando el inventario y guardando el aviso al cliente.", "Pedido cancelado; el aviso quedó disponible para el cliente."],
    guardarInventario: ["Guardando inventario…", "Actualizando las cantidades del día.", "Inventario del día guardado."],
    cambiarEstadoPedidos: ["Actualizando pedidos…", "Cambiando si los clientes pueden enviar pedidos.", "Estado de pedidos actualizado."],
    guardarInversion: ["Guardando inversión…", "Actualizando el cierre de la semana.", "Inversión guardada."],
    cerrarSemana: ["Cerrando la semana…", "Guardando el cierre y preparando la siguiente semana.", "Semana cerrada correctamente."],
    guardarConfig: ["Guardando configuración…", "Actualizando los tipos y precios.", "Configuración guardada."],
  };
  return messages[action] || ["Guardando…", "Actualizando la información.", "Cambios guardados."];
}

async function syncAfterAction(action) {
  const accionesParciales = [
    "crearPedido",
    "editarPedido",
    "eliminarPedido",
    "guardarInventario",
    "guardarConfig",
  ];

  if (!accionesParciales.includes(action)) {
    onDataLoaded(await apiGet("dashboard"));
    return;
  }

  if (action === "guardarInventario") {
    const data = await apiGet("dashboard");
    onDataLoaded(data);
    return;
  }

  if (action === "guardarConfig") {
    const [config, inventario] = await Promise.all([
      apiGet("config"),
      apiGet("inventario", { fecha: STATE.fechaOperativa }),
    ]);
    STATE.config = config;
    STATE.inventario = inventario;
    refreshItemRowOptions();
    renderConfig();
    renderInventario();
    refreshFormState();
    return;
  }

  const [pedidos, inventario] = await Promise.all([
    apiGet("pedidos"),
    apiGet("inventario", { fecha: STATE.fechaOperativa }),
  ]);
  STATE.pendientes = pedidos.filter((p) => p.estado === "Pendiente");
  STATE.completados = pedidos.filter((p) => p.estado === "Completado");
  STATE.inventario = inventario;
  renderPedidosActivos();
  renderInventario();
  renderDashboardStats();
  refreshFormState();
}

async function postAndSync(action, payload) {
  const [loadingTitle, loadingMessage, successMessage] = actionFeedback(action);
  showLoading(loadingTitle, loadingMessage);
  setConnStatus("Sincronizando…");
  try {
    const data = await apiPost(action, payload);
    await syncAfterAction(action);
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
