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

