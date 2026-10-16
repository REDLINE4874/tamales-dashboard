/* ==========================================================
   DASHBOARD
   ========================================================== */

function renderDashboardStats() {
  const semanaActual = STATE.resumenSemanal.find(
    (s) => s.semana === STATE.semanaActual,
  );
  const pedidosSemanaActual = (pedidos) =>
    pedidos.filter((pedido) => pedido.semana === STATE.semanaActual).length;
  document.getElementById("statSemanaActual").textContent =
    "$" + (semanaActual ? semanaActual.total.toFixed(0) : "0");
  document.getElementById("statCompletados").textContent =
    pedidosSemanaActual(STATE.completados);
  document.getElementById("statPendientes").textContent =
    pedidosSemanaActual(STATE.pendientes);
}

function monthKeyFromWeek(weekKey) {
  const match = /^(\d{4}-\d{2})-S\d+$/.exec(weekKey);
  return match ? match[1] : "";
}

function monthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function renderChartMonthFilter() {
  const select = document.getElementById("chartMonthFilter");
  if (!select) return;

  const previousMonth = select.value;
  const months = new Set(
    STATE.resumenSemanal.map((summary) => monthKeyFromWeek(summary.semana)),
  );
  const currentMonth = monthKeyFromWeek(STATE.semanaActual);
  if (currentMonth) months.add(currentMonth);

  const sortedMonths = [...months].filter(Boolean).sort().reverse();
  select.innerHTML = sortedMonths
    .map(
      (month) =>
        `<option value="${month}">${monthLabel(month)}</option>`,
    )
    .join("");

  if (sortedMonths.includes(previousMonth)) {
    select.value = previousMonth;
  } else if (currentMonth && sortedMonths.includes(currentMonth)) {
    select.value = currentMonth;
  } else if (sortedMonths.length) {
    select.value = sortedMonths[0];
  }
  refreshCustomSelect(select);
}

function drawChart() {
  const el = document.getElementById("chartGanancias");
  if (!el) return;

  const monthFilter = document.getElementById("chartMonthFilter");
  const selectedMonth = monthFilter ? monthFilter.value : "";
  const monthSummaries = STATE.resumenSemanal
    .filter((summary) => monthKeyFromWeek(summary.semana) === selectedMonth)
    .sort((a, b) => a.semana.localeCompare(b.semana));
  const monthlyTotal = monthSummaries.reduce(
    (total, summary) => total + Number(summary.total || 0),
    0,
  );
  const monthlyOrders = monthSummaries.reduce(
    (total, summary) => total + Number(summary.pedidos || 0),
    0,
  );

  document.getElementById("chartMonthLabel").textContent = selectedMonth
    ? `Total de ${monthLabel(selectedMonth)}`
    : "Total del mes";
  document.getElementById("chartMonthTotal").textContent =
    "$" + monthlyTotal.toFixed(0);
  document.getElementById("chartMonthOrders").textContent = monthlyOrders;

  if (!monthSummaries.length) {
    el.innerHTML =
      '<div class="empty-state">Aún no hay ventas completadas en este mes.</div>';
    return;
  }

  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn("string", "Semana");
  dataTable.addColumn("number", "Ganancias");
  monthSummaries.forEach((s) =>
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
    .getElementById("chartMonthFilter")
    ?.addEventListener("change", () => {
      if (chartsReady) drawChart();
    });
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
    await showAppDialog({
      title: "Falta la inversión",
      message: "Escribe el monto invertido para registrar el cierre.",
      confirmText: "Entendido",
    });
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
    await showAppDialog({
      title: "Monto inválido",
      message: "Escribe un monto de inversión numérico antes de cerrar la semana.",
      confirmText: "Entendido",
    });
    return;
  }
  const confirmar = await showAppDialog({
    title: "Cerrar semana",
    message: `Se guardarán las ganancias de ${STATE.semanaActualLabel} y se iniciará una nueva semana con el inventario en cero. ¿Deseas continuar?`,
    confirmText: "Sí, cerrar semana",
    showCancel: true,
    danger: true,
  });
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
  const monthFilter = document.getElementById("historyMonthFilter");
  const yearFilter = document.getElementById("historyYearFilter");
  const currentDate = new Date();
  const currentMonth = String(currentDate.getMonth() + 1).padStart(2, "0");
  const currentYear = String(currentDate.getFullYear());
  const previousMonth = monthFilter.value;
  const previousYear = yearFilter.value;
  const records = [];
  const years = new Set();
  const monthsByYear = new Map();

  STATE.resumenSemanal.forEach((summary) => {
    const match = /^(\d{4})-(\d{2})-S\d+$/.exec(summary.semana);
    if (!match) return;
    const [, year, month] = match;
    records.push({ summary, year, month });
    years.add(year);
    if (!monthsByYear.has(year)) monthsByYear.set(year, new Set());
    monthsByYear.get(year).add(month);
  });

  const sortedYears = [...years].sort((a, b) => b.localeCompare(a));
  const selectedYear = years.has(previousYear)
    ? previousYear
    : years.has(currentYear)
      ? currentYear
      : sortedYears[0] || currentYear;
  const availableMonths = [...(monthsByYear.get(selectedYear) || [])].sort(
    (a, b) => b.localeCompare(a),
  );
  const selectedMonth = availableMonths.includes(previousMonth)
    ? previousMonth
    : availableMonths.includes(currentMonth) && selectedYear === currentYear
      ? currentMonth
      : availableMonths[0] || "";

  monthFilter.innerHTML = availableMonths.length
    ? availableMonths.map((month) => {
    const label = new Intl.DateTimeFormat("es-MX", { month: "long" }).format(
      new Date(2000, Number(month) - 1, 1),
    );
    return `<option value="${month}">${label}</option>`;
    }).join("")
    : '<option value="" disabled>Sin registros</option>';
  yearFilter.innerHTML = sortedYears
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("") || `<option value="${currentYear}">${currentYear}</option>`;
  monthFilter.value = selectedMonth;
  yearFilter.value = selectedYear;
  monthFilter.disabled = availableMonths.length === 0;
  yearFilter.disabled = sortedYears.length === 0;
  refreshCustomSelect(monthFilter);
  refreshCustomSelect(yearFilter);

  const semanas = records
    .filter(
      ({ year, month }) =>
        year === yearFilter.value && month === monthFilter.value,
    )
    .map(({ summary }) => summary)
    .sort((a, b) => b.semana.localeCompare(a.semana));

  const ventasMes = semanas.reduce(
    (total, semana) => total + Number(semana.total || 0),
    0,
  );
  const inversionRegistrada = semanas.reduce(
    (total, semana) =>
      total + (semana.registrada ? Number(semana.inversion || 0) : 0),
    0,
  );
  const cierresPendientes = semanas.filter((semana) => !semana.registrada).length;
  const utilidadMes = ventasMes - inversionRegistrada;
  document.getElementById("historyMonthlySummary").innerHTML = `
    <div class="history-monthly-card">
      <span class="stat-label">Ventas del mes</span>
      <strong class="stat-value mono">$${ventasMes.toFixed(0)}</strong>
    </div>
    <div class="history-monthly-card">
      <span class="stat-label">${cierresPendientes ? "Utilidad provisional" : "Utilidad del mes"}</span>
      <strong class="stat-value mono ${utilidadMes >= 0 ? "pos" : "neg"}">$${utilidadMes.toFixed(0)}</strong>
      ${cierresPendientes ? `<span class="history-monthly-note">Falta${cierresPendientes === 1 ? "" : "n"} registrar ${cierresPendientes} cierre${cierresPendientes === 1 ? "" : "s"} semanal${cierresPendientes === 1 ? "" : "es"}.</span>` : ""}
    </div>
  `;

  if (!semanas.length) {
    wrap.innerHTML =
      '<div class="empty-state">No hay ventas registradas para el mes y año seleccionados.</div>';
  } else {
    const rows = semanas
      .map((summary, index) => {
        const pedidosSemana = STATE.completados.filter(
          (pedido) => pedido.semana === summary.semana,
        );
        const utilidad = summary.registrada
          ? `<span class="utilidad ${summary.utilidad >= 0 ? "pos" : "neg"} mono">$${summary.utilidad.toFixed(0)}</span>`
          : '<span class="utilidad-pill pending">Sin cerrar</span>';
        const detalleInversion = summary.registrada
          ? `<div class="invest-summary">
               <span>Inversión: <strong class="mono">$${summary.inversion.toFixed(0)}</strong></span>
               <span class="utilidad ${summary.utilidad >= 0 ? "pos" : "neg"}">Utilidad: <strong class="mono">$${summary.utilidad.toFixed(0)}</strong></span>
             </div>`
          : `<div class="invest-form">
               <input type="number" class="invest-input" id="invest-input-${index}" placeholder="Inversión de la semana" step="0.01">
               <button class="btn-ghost" onclick="registrarInversion('${summary.semana}', ${index})">Registrar inversión</button>
             </div>`;
        const pedidosHtml = pedidosSemana.length
          ? pedidosSemana
              .map(
                (pedido) => `
                  <div class="pedido-row">
                    <div>
                      <div class="p-cliente">${escapeHtml(pedido.cliente)}</div>
                      <div class="p-detalle">${pedido.detalle.map((item) => escapeHtml(item.tipo) + " x" + item.cantidad).join(", ")}</div>
                    </div>
                    <div class="mono">$${Number(pedido.montoCobrado).toFixed(0)}</div>
                  </div>
                `,
              )
              .join("")
          : '<div class="empty-state">No hay pedidos completados esta semana.</div>';

        return `
          <tr>
            <th scope="row">${summary.label}</th>
            <td data-label="Pedidos">${summary.pedidos}</td>
            <td data-label="Ventas" class="mono">$${summary.total.toFixed(0)}</td>
            <td data-label="Inversión">${summary.registrada ? `$${summary.inversion.toFixed(0)}` : "—"}</td>
            <td data-label="Utilidad">${utilidad}</td>
            <td data-label="Pedidos completados">
              <button type="button" class="btn-ghost history-detail-toggle" aria-expanded="false" aria-controls="week-detail-${index}" onclick="toggleWeek(${index})">Ver detalle</button>
            </td>
          </tr>
          <tr class="history-detail-row" id="week-detail-${index}">
            <td colspan="6" data-label="">
              <div class="history-week-detail">
                ${detalleInversion}
                ${pedidosHtml}
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    wrap.innerHTML = `
      <div class="history-table-wrap">
        <table class="history-table">
          <thead>
            <tr><th>Semana</th><th>Pedidos</th><th>Ventas</th><th>Inversión</th><th>Utilidad</th><th>Detalle</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  monthFilter.onchange = renderHistorico;
  yearFilter.onchange = renderHistorico;
}

function toggleWeek(i) {
  const detail = document.getElementById("week-detail-" + i);
  const isOpen = detail.classList.toggle("open");
  const toggle = document.querySelector(
    `.history-detail-toggle[aria-controls="week-detail-${i}"]`,
  );
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.textContent = isOpen ? "Ocultar detalle" : "Ver detalle";
}
