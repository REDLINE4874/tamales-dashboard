/* ==========================================================
   NUEVO PEDIDO / EDICIÓN DE PEDIDO
   ========================================================== */

function addItemRow(presetTipo, presetCantidad) {
  const list = document.getElementById("itemsList");
  const row = document.createElement("div");
  row.className = "item-row";

  row.innerHTML = `
    <div class="item-row-main">
      <div class="item-type-group">
        <select class="item-tipo" aria-label="Tipo de tamal">${optionsHTML()}</select>
        <div class="item-hint"></div>
      </div>
      <div class="item-row-actions">
        <div class="cant-control">
          <button type="button" class="btn-minus">−</button>
          <input type="number" class="item-cant" min="1" step="1" value="${presetCantidad || 1}" placeholder="Cant.">
          <button type="button" class="btn-plus">+</button>
        </div>
        <button type="button" class="item-remove-btn" aria-label="Quitar tamal">
          <span aria-hidden="true"></span>
        </button>
      </div>
    </div>
  `;

  if (presetTipo) {
    const sel = row.querySelector(".item-tipo");
    if ([...sel.options].some((o) => o.value === presetTipo)) {
      sel.value = presetTipo;
    }
  }

  row.querySelector(".item-remove-btn").addEventListener("click", () => {
    row.remove();
    refreshFormState();
  });
  const input = row.querySelector(".item-cant");
  input.addEventListener("input", refreshFormState);
  row.querySelector(".item-tipo").addEventListener("change", refreshFormState);

  row.querySelector(".btn-minus").addEventListener("click", () => {
    input.value = Math.max(1, Math.round(Number(input.value) || 0) - 1);
    refreshFormState();
  });

  row.querySelector(".btn-plus").addEventListener("click", () => {
    input.value = Math.max(1, Math.round(Number(input.value) || 0) + 1);
    refreshFormState();
  });

  list.appendChild(row);
  enhanceCustomSelect(row.querySelector(".item-tipo"));
  installSvgIcons();
  refreshFormState();
}

function optionsHTML() {
  return (STATE.config.tipos || [])
    .map((t) => `<option value="${escapeHtml(t.tipo)}">${escapeHtml(t.tipo)}</option>`)
    .join("");
}

/** Precio de un tipo de tamal según Config. 0 si el tipo ya no existe. */
function precioDeTipo(tipo) {
  const t = (STATE.config.tipos || []).find((x) => x.tipo === tipo);
  return t ? Number(t.precio) || 0 : 0;
}

function refreshItemRowOptions() {
  document.querySelectorAll(".item-tipo").forEach((sel) => {
    const current = sel.value;
    sel.innerHTML = optionsHTML();
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
    refreshCustomSelect(sel);
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
  let total = 0;
  let hayExcedente = false;
  let hayCantidadNoEntera = false;
  const rows = [...document.querySelectorAll("#itemsList .item-row")];
  const cantidadPorTipo = new Map();
  const disponiblePorTipo = new Map();

  rows.forEach((row) => {
    const tipo = row.querySelector(".item-tipo").value;
    const cantidadInput = row.querySelector(".item-cant").value;
    const cantidad = Number(cantidadInput || 0);
    cantidadTotal += cantidad;
    total += cantidad * precioDeTipo(tipo);

    if (cantidadInput !== "" && !Number.isInteger(cantidad)) {
      hayCantidadNoEntera = true;
    }
    cantidadPorTipo.set(tipo, (cantidadPorTipo.get(tipo) || 0) + cantidad);
  });

  rows.forEach((row) => {
    const tipo = row.querySelector(".item-tipo").value;
    const hint = row.querySelector(".item-hint");
    const inv = (STATE.inventario || []).find((item) => item.tipo === tipo);
    if (!inv || !inv.configurado) {
      hint.textContent = "Disponibles: 0";
      hint.className = cantidadPorTipo.get(tipo) > 0
        ? "item-hint item-hint-error"
        : "item-hint";
      if (cantidadPorTipo.get(tipo) > 0) hayExcedente = true;
      return;
    }

    if (!disponiblePorTipo.has(tipo)) {
      const reservadoOriginal = (editingOriginalItems || [])
        .filter((item) => item.tipo === tipo)
        .reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
      disponiblePorTipo.set(
        tipo,
        Number(inv.disponible || 0) + reservadoOriginal,
      );
    }

    const disponible = disponiblePorTipo.get(tipo);
    const solicitado = cantidadPorTipo.get(tipo) || 0;
    const restante = Math.max(disponible - solicitado, 0);
    if (solicitado > disponible) {
      hint.textContent = `Disponibles: ${restante}`;
      hint.className = "item-hint item-hint-error";
      hayExcedente = true;
    } else {
      hint.textContent = `Disponibles: ${restante}`;
      hint.className = "item-hint";
    }
  });

  document.getElementById("totalEstimado").textContent = "$" + total.toFixed(0);

  const warning = document.getElementById("pedidoWarning");
  const btn = document.getElementById("crearPedidoBtn");
  if (hayCantidadNoEntera) {
    warning.hidden = false;
    warning.textContent = "La cantidad de cada tamal debe ser un número entero.";
    btn.disabled = true;
  } else if (hayExcedente) {
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
    await showAppDialog({
      title: "Falta el nombre del cliente",
      message: "Escribe el nombre para poder crear la comanda.",
      confirmText: "Entendido",
    });
    return;
  }

  const items = [];
  let cantidadNoEntera = false;
  document.querySelectorAll("#itemsList .item-row").forEach((r) => {
    const tipo = r.querySelector(".item-tipo").value;
    const cantidadInput = r.querySelector(".item-cant").value;
    const cantidad = Number(cantidadInput || 0);
    if (cantidadInput !== "" && !Number.isInteger(cantidad)) {
      cantidadNoEntera = true;
      return;
    }
    if (cantidad > 0) items.push({ tipo, cantidad });
  });
  if (cantidadNoEntera) {
    await showAppDialog({
      title: "Revisa las cantidades",
      message: "La cantidad de cada tamal debe ser un número entero.",
      confirmText: "Entendido",
    });
    return;
  }
  if (!items.length) {
    await showAppDialog({
      title: "Pedido sin tamales",
      message: "Agrega al menos un tamal antes de guardar la comanda.",
      confirmText: "Entendido",
    });
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
    restablecerFormularioPedido();
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

  document.getElementById("crearPedidoBtn").querySelector("span").textContent =
    "Guardar cambios";
  document.getElementById("editBannerCliente").textContent = pedido.cliente;
  document.getElementById("editBanner").hidden = false;

  document.querySelector('.nav-item[data-view="nuevo"]').click();
  refreshFormState();
}

/** Sale del modo edición y deja el formulario listo para un pedido nuevo. */
function cancelarEdicion() {
  if (!editingPedidoId) return;
  restablecerFormularioPedido();
  showToast("Edición cancelada. El pedido original no fue modificado.");
}

function restablecerFormularioPedido() {
  editingPedidoId = null;
  editingOriginalItems = null;

  document.getElementById("clienteInput").value = "";
  document.getElementById("itemsList").innerHTML = "";
  document.getElementById("editBannerCliente").textContent = "";
  addItemRow();

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
  const confirmar = await showAppDialog({
    title: "Eliminar comanda",
    message: `¿Quieres eliminar la comanda de ${nombre}? Los tamales volverán al inventario disponible.`,
    confirmText: "Sí, eliminar",
    showCancel: true,
    danger: true,
  });
  if (!confirmar) return;

  try {
    await postAndSync("eliminarPedido", { id });
    if (editingPedidoId === id) restablecerFormularioPedido();
  } catch (err) {
    onError(err);
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
