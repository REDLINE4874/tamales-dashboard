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
}

async function guardarConfigTipos() {
  const warning = document.getElementById("configWarning");
  warning.hidden = true;

  const tipos = [];
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

  const btn = document.getElementById("guardarConfigBtn");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await postAndSync("guardarConfig", { tipos });
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
