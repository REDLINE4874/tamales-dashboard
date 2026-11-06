/* ==========================================================
   TIPOS Y PRECIOS (Config)
   ========================================================== */

function setupConfig() {
  document.getElementById("addTipoBtn").addEventListener("click", () => {
    addTipoRow("", "");
  });
  document
    .getElementById("guardarConfigBtn")
    .addEventListener("click", guardarConfigTipos);
}

function addTipoRow(tipo, precio) {
  const list = document.getElementById("tiposList");
  const row = document.createElement("tr");
  row.className = "tipo-row";
  row.innerHTML = `
    <td><input type="text" class="tipo-nombre" placeholder="Nombre del tipo" value="${escapeHtml(tipo || "")}"></td>
    <td><label class="tipo-price-input"><span>$</span><input type="number" class="tipo-precio" min="0" step="0.01" placeholder="0.00" value="${precio !== "" && precio != null ? precio : ""}"></label></td>
    <td><button type="button" class="item-remove-btn" aria-label="Eliminar tipo de tamal"><span aria-hidden="true"></span></button></td>
  `;
  row.querySelector(".item-remove-btn").addEventListener("click", () => row.remove());
  list.appendChild(row);
  installSvgIcons();
}

/** Vuelve a dibujar la lista de tipos/precios a partir de STATE.config. */
function renderConfig() {
  const list = document.getElementById("tiposList");
  list.innerHTML = "";
  const tipos = STATE.config.tipos || [];
  if (!tipos.length) {
    addTipoRow("", "");
  } else {
    tipos.forEach((t) => addTipoRow(t.tipo, t.precio));
  }

  const bebidaList = document.getElementById("bebidasList");
  const bebidas = STATE.config.bebidas?.length ? STATE.config.bebidas : [
    { tipo: "Atole chico (500 ml)", precio: 0, activo: false },
    { tipo: "Atole grande (1 L)", precio: 0, activo: false },
  ];
  bebidaList.innerHTML = bebidas.map((bebida) => `
    <tr class="bebida-row" data-tipo="${escapeHtml(bebida.tipo)}">
      <td>${escapeHtml(bebida.tipo)}</td>
      <td><label class="tipo-price-input"><span>$</span><input type="number" class="bebida-precio" min="0" step="0.01" value="${Number(bebida.precio || 0)}"></label></td>
      <td><input type="checkbox" class="beverage-enabled" aria-label="Mostrar ${escapeHtml(bebida.tipo)} en el menú" ${bebida.activo ? "checked" : ""}></td>
    </tr>`).join("");
}

async function guardarConfigTipos() {
  const warning = document.getElementById("configWarning");
  warning.hidden = true;

  const tipos = [];
  const bebidas = [];
  const nombres = new Set();
  let error = "";

  document.querySelectorAll("#tiposList .tipo-row").forEach((row) => {
    const tipo = row.querySelector(".tipo-nombre").value.trim();
    const precioVal = row.querySelector(".tipo-precio").value;
    if (!tipo && precioVal === "") return; // renglón vacío, se ignora

    if (!tipo) {
      error = "Todos los tipos necesitan un nombre.";
      return;
    }
    if (nombres.has(tipo)) {
      error = `El tipo "${tipo}" está repetido.`;
      return;
    }
    nombres.add(tipo);

    const precio = Number(precioVal);
    if (precioVal === "" || isNaN(precio) || precio < 0) {
      error = `Escribe un precio válido para "${tipo}".`;
      return;
    }
    tipos.push({ tipo, precio });
  });

  if (error) {
    warning.hidden = false;
    warning.textContent = error;
    return;
  }
  if (!tipos.length) {
    warning.hidden = false;
    warning.textContent = "Agrega al menos un tipo de tamal.";
    return;
  }

  document.querySelectorAll("#bebidasList .bebida-row").forEach((row) => {
    const precio = Number(row.querySelector(".bebida-precio").value);
    if (!Number.isFinite(precio) || precio < 0) {
      error = `Escribe un precio válido para ${row.dataset.tipo}.`;
      return;
    }
    bebidas.push({
      tipo: row.dataset.tipo,
      precio,
      activo: row.querySelector(".beverage-enabled").checked,
    });
  });
  if (error) {
    warning.hidden = false;
    warning.textContent = error;
    return;
  }

  const btn = document.getElementById("guardarConfigBtn");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await postAndSync("guardarConfig", { tipos, bebidas });
  } catch (err) {
    onError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar cambios";
  }
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
