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
  const groups = [
    { key: "tamal", title: "Tamales", open: STATE.pedidosTamalesAbiertos },
    { key: "bebida", title: "Bebidas", open: STATE.pedidosBebidasAbiertos },
  ];
  wrap.innerHTML = groups.map((group) => {
    const products = STATE.inventario.filter((inv) => (inv.categoria || "tamal") === group.key);
    const rows = products.map((inv) => {
      const pct =
        inv.configurado && inv.cantidadInicial > 0
          ? Math.min(100, Math.round(((inv.vendido + (inv.reservado || 0)) / inv.cantidadInicial) * 100))
          : 0;
      return `
      <div class="inv-row" data-tipo="${escapeHtml(inv.tipo)}">
        <div class="inv-row-top">
          <span class="inv-tipo">${escapeHtml(inv.tipo)}</span>
          <span class="inv-vendido mono">Pedidos: ${inv.vendido}${inv.reservado ? ` · Apartados: ${inv.reservado}` : ""}</span>
        </div>
        <div class="inv-row-main">
          <input type="number" class="inv-input" min="0" step="1"
                 value="${inv.cantidadInicial}"
                 placeholder="Cantidad inicial">
          <span class="inv-disponible mono ${!inv.configurado || inv.disponible === 0 ? "inv-agotado" : ""}">
            ${inv.configurado ? `Disponible: ${inv.disponible}` : "Inventario de hoy pendiente"}
          </span>
        </div>
        <div class="inv-bar"><div class="inv-bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
    }).join("");
    return `
      <section class="inventory-category" data-category="${group.key}">
        <header class="inventory-category-head">
          <div><h2>${group.title}</h2><span class="inventory-category-state ${group.open ? "is-open" : ""}">${group.open ? "Pedidos abiertos" : "Pedidos cerrados"}</span></div>
          <button type="button" class="btn-ghost inventory-toggle-btn" data-category="${group.key}" aria-pressed="${group.open}">${group.open ? "Cerrar" : "Abrir"}</button>
        </header>
        <div class="inventory-category-rows">${rows || '<div class="empty-state">No hay productos configurados en esta categoría.</div>'}</div>
      </section>`;
  }).join("");

  // El formulario de pedidos usa STATE.inventario para validar disponibilidad.
  // Mantenerlo sincronizado mientras se edita el stock evita dejar visible un
  // warning de excedente después de aumentar la cantidad.
  wrap.querySelectorAll(".inv-row").forEach((row) => {
    row.querySelector(".inv-input").addEventListener("input", () => {
      const inv = STATE.inventario.find((item) => item.tipo === row.dataset.tipo);
      if (!inv) return;

      const cantidad = Number(row.querySelector(".inv-input").value || 0);
      if (!Number.isInteger(cantidad) || cantidad < 0) return;

      inv.cantidadInicial = cantidad;
      inv.disponible = Math.max(cantidad - Number(inv.vendido || 0) - Number(inv.reservado || 0), 0);
      inv.configurado = true;

      const disponible = row.querySelector(".inv-disponible");
      disponible.textContent = `Disponible: ${inv.disponible}`;
      disponible.classList.toggle("inv-agotado", inv.disponible === 0);
      refreshFormState();
    });
  });

  wrap.querySelectorAll(".inventory-toggle-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const category = button.dataset.category;
      const isOpen = category === "bebida" ? STATE.pedidosBebidasAbiertos : STATE.pedidosTamalesAbiertos;
      try {
        await postAndSync("cambiarEstadoPedidos", { categoria: category, abierto: !isOpen });
      } catch (err) {
        onError(err);
      }
    });
  });
}

async function elegirCategoriasAbiertas() {
  const dialog = document.getElementById("inventorySaveDialog");
  document.getElementById("openTamalesAfterSave").checked = STATE.pedidosTamalesAbiertos;
  document.getElementById("openDrinksAfterSave").checked = STATE.pedidosBebidasAbiertos;
  dialog.showModal();
  return await new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      if (dialog.returnValue !== "save") return resolve(null);
      resolve({
        abrirTamales: document.getElementById("openTamalesAfterSave").checked,
        abrirBebidas: document.getElementById("openDrinksAfterSave").checked,
      });
    }, { once: true });
  });
}

async function guardarInventario() {
  const items = [];
  let cantidadNoEntera = false;
  document.querySelectorAll(".inv-row").forEach((row) => {
    const tipo = row.dataset.tipo;
    const val = row.querySelector(".inv-input").value;
    {
      const cantidad = val === "" ? 0 : Number(val);
      if (!Number.isInteger(cantidad) || cantidad < 0) {
        cantidadNoEntera = true;
        return;
      }
      items.push({ tipo, cantidad });
    }
  });
  if (cantidadNoEntera) {
    await showAppDialog({
      title: "Cantidad de inventario inválida",
      message: "Usa números enteros iguales o mayores que cero para guardar el inventario.",
      confirmText: "Entendido",
    });
    return;
  }
  const opciones = await elegirCategoriasAbiertas();
  if (!opciones) return;
  const btn = document.getElementById("guardarInventarioBtn");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await postAndSync("guardarInventario", {
      fecha: STATE.fechaOperativa,
      semana: STATE.semanaActual,
      items,
      abrirTamales: opciones.abrirTamales,
      abrirBebidas: opciones.abrirBebidas,
    });
  } catch (err) {
    onError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar inventario del día";
  }
}
