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
          <input type="number" class="inv-input" min="0" step="1"
                 value="${inv.cantidadInicial}"
                 placeholder="Cantidad inicial">
          <span class="inv-disponible mono ${inv.configurado && inv.disponible === 0 ? "inv-agotado" : ""}">
            Disponible: ${inv.disponible}
          </span>
        </div>
        <div class="inv-bar"><div class="inv-bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
    })
    .join("");

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
      inv.disponible = Math.max(cantidad - Number(inv.vendido || 0), 0);

      const disponible = row.querySelector(".inv-disponible");
      disponible.textContent = `Disponible: ${inv.disponible}`;
      disponible.classList.toggle("inv-agotado", inv.disponible === 0);
      refreshFormState();
    });
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
