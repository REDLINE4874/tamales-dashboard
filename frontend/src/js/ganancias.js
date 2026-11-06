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
    colors: ["#A4E5B8"],
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
      textStyle: { color: "#E4DFD5", fontName: "Space Grotesk", fontSize },
      gridlines: { color: "#414141" },
    },
    vAxis: {
      textStyle: { color: "#E4DFD5", fontName: "Space Grotesk", fontSize },
      gridlines: { color: "#414141" },
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
  if (!el) return;
  const fecha = STATE.fechaOperativa;
  const tieneInventario = STATE.diasConInventario.includes(fecha);
  const cierre = STATE.cierresDiarios.find((item) => item.fecha_operativa === fecha);
  const pedidos = STATE.completados.filter((pedido) => pedido.fechaOperativa === fecha);
  const ventas = pedidos.reduce((total, pedido) => total + Number(pedido.montoCobrado || 0), 0);
  const label = fecha ? new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${fecha}T12:00:00Z`)) : "hoy";
  if (!tieneInventario) {
    el.innerHTML = `<h3>Cierre del ${label}</h3><p class="invest-hint">Guarda el inventario del día para habilitar su cierre.</p>`;
  } else if (cierre) {
    const utilidad = ventas - Number(cierre.inversion || 0);
    el.innerHTML = `<h3>Cierre del ${label}</h3><div class="invest-summary"><span>Ventas: <strong class="mono">$${ventas.toFixed(2)}</strong></span><span>Inversión: <strong class="mono">$${Number(cierre.inversion).toFixed(2)}</strong></span><span class="utilidad ${utilidad >= 0 ? "pos" : "neg"}">Utilidad: <strong class="mono">$${utilidad.toFixed(2)}</strong></span></div>`;
  } else {
    el.innerHTML = `<h3>Cierre del ${label}</h3><p class="invest-hint">Ventas completadas: <strong class="mono">$${ventas.toFixed(2)}</strong>. Registra la inversión de este día.</p><div class="invest-form"><input type="number" min="0" class="invest-input" id="invest-input-current" placeholder="Inversión del día" step="0.01"><button class="btn-primary" onclick='registrarCierreDiario("${fecha}")'>Cerrar día</button></div>`;
  }
}

async function registrarCierreDiario(fecha) {
  const input = document.getElementById("invest-input-current");
  if (!input || input.value === "" || Number(input.value) < 0 || !Number.isFinite(Number(input.value))) {
    await showAppDialog({ title: "Inversión pendiente", message: "Escribe una inversión válida para cerrar este día.", confirmText: "Entendido" });
    return;
  }
  try {
    await postAndSync("guardarCierreDiario", { fecha, inversion: Number(input.value) });
  } catch (err) { onError(err); }
}
function renderHistorico() {
  const wrap = document.getElementById("historicoList");
  const monthFilter = document.getElementById("historyMonthFilter");
  const yearFilter = document.getElementById("historyYearFilter");
  if (!wrap || !monthFilter || !yearFilter) return;
  const now = new Date();
  const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
  const currentYear = String(now.getFullYear());
  const previousMonth = monthFilter.value;
  const previousYear = yearFilter.value;
  const cierreByDate = new Map(STATE.cierresDiarios.map((item) => [item.fecha_operativa, item]));
  const records = STATE.diasConInventario.map((fecha) => {
    const pedidos = STATE.completados.filter((pedido) => pedido.fechaOperativa === fecha);
    const ventas = pedidos.reduce((total, pedido) => total + Number(pedido.montoCobrado || 0), 0);
    const cierre = cierreByDate.get(fecha);
    return { fecha, year: fecha.slice(0, 4), month: fecha.slice(5, 7), pedidos, ventas, cierre, inversion: cierre ? Number(cierre.inversion || 0) : null };
  });
  const weeklyRecords = STATE.resumenSemanal
    .filter((item) => item.registrada)
    .map((summary) => {
      const match = /^(\d{4})-(\d{2})-S\d+$/.exec(summary.semana);
      return match ? { ...summary, year: match[1], month: match[2] } : null;
    })
    .filter(Boolean);
  const years = [...new Set([...records.map((item) => item.year), ...weeklyRecords.map((item) => item.year)])].sort((a, b) => b.localeCompare(a));
  const selectedYear = years.includes(previousYear) ? previousYear : years.includes(currentYear) ? currentYear : years[0] || currentYear;
  const months = [...new Set([
    ...records.filter((item) => item.year === selectedYear).map((item) => item.month),
    ...weeklyRecords.filter((item) => item.year === selectedYear).map((item) => item.month),
  ])].sort((a, b) => b.localeCompare(a));
  const selectedMonth = months.includes(previousMonth) ? previousMonth : months.includes(currentMonth) && selectedYear === currentYear ? currentMonth : months[0] || "";
  monthFilter.innerHTML = months.length ? months.map((month) => `<option value="${month}">${new Intl.DateTimeFormat("es-MX", { month: "long" }).format(new Date(2000, Number(month) - 1, 1))}</option>`).join("") : '<option value="" disabled>Sin registros</option>';
  yearFilter.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("") || `<option value="${currentYear}">${currentYear}</option>`;
  monthFilter.value = selectedMonth;
  yearFilter.value = selectedYear;
  monthFilter.disabled = months.length === 0;
  yearFilter.disabled = years.length === 0;
  refreshCustomSelect(monthFilter);
  refreshCustomSelect(yearFilter);

  const days = records.filter((item) => item.year === yearFilter.value && item.month === monthFilter.value).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const totalVentas = days.reduce((total, item) => total + item.ventas, 0);
  const totalInversion = days.reduce((total, item) => total + (item.inversion ?? 0), 0);
  const pendientes = days.filter((item) => item.inversion == null).length;
  const utilidad = totalVentas - totalInversion;
  document.getElementById("historyMonthlySummary").innerHTML = `<div class="history-monthly-card"><span class="stat-label">Ventas del mes</span><strong class="stat-value mono">$${totalVentas.toFixed(2)}</strong></div><div class="history-monthly-card"><span class="stat-label">${pendientes ? "Utilidad provisional" : "Utilidad del mes"}</span><strong class="stat-value mono ${utilidad >= 0 ? "pos" : "neg"}">$${utilidad.toFixed(2)}</strong>${pendientes ? `<span class="history-monthly-note">Falta${pendientes === 1 ? "" : "n"} cerrar ${pendientes} día${pendientes === 1 ? "" : "s"} con inventario.</span>` : ""}</div>`;

  if (!days.length) {
    wrap.innerHTML = '<div class="empty-state">No hay días con inventario en el mes y año seleccionados.</div>';
  } else {
    const rows = days.map((day, index) => {
      const utilidadDia = day.inversion == null ? null : day.ventas - day.inversion;
      const inversionHtml = day.inversion == null
        ? `<div class="invest-form"><input type="number" min="0" class="invest-input" id="daily-invest-${index}" placeholder="Inversión del día" step="0.01"><button class="btn-ghost" onclick='registrarCierreHistorico("${day.fecha}", ${index})'>Cerrar día</button></div>`
        : `$${day.inversion.toFixed(2)}`;
      const utilidadHtml = utilidadDia == null ? '<span class="utilidad-pill pending">Pendiente</span>' : `<span class="utilidad ${utilidadDia >= 0 ? "pos" : "neg"} mono">$${utilidadDia.toFixed(2)}</span>`;
      const pedidosHtml = day.pedidos.length ? day.pedidos.map((pedido) => `<div class="pedido-row"><div><div class="p-cliente">${escapeHtml(pedido.cliente)}</div><div class="p-detalle">${pedido.detalle.map((item) => escapeHtml(item.tipo) + " x" + item.cantidad).join(", ")}</div></div><div class="mono">$${Number(pedido.montoCobrado || 0).toFixed(2)}</div></div>`).join("") : '<div class="empty-state">No hay pedidos completados este día.</div>';
      const dateLabel = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day.fecha}T12:00:00Z`));
      return `<tr><th scope="row">${dateLabel}</th><td data-label="Pedidos">${day.pedidos.length}</td><td data-label="Ventas" class="mono">$${day.ventas.toFixed(2)}</td><td data-label="Inversión">${inversionHtml}</td><td data-label="Utilidad">${utilidadHtml}</td><td data-label="Detalle"><button type="button" class="btn-ghost history-detail-toggle" aria-expanded="false" aria-controls="day-detail-${index}" onclick="toggleDay(${index})">Ver detalle</button></td></tr><tr class="history-detail-row" id="day-detail-${index}"><td colspan="6"><div class="history-week-detail">${pedidosHtml}</div></td></tr>`;
    }).join("");
    wrap.innerHTML = `<div class="history-table-wrap"><table class="history-table"><thead><tr><th>Día con inventario</th><th>Pedidos</th><th>Ventas</th><th>Inversión</th><th>Utilidad</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  monthFilter.onchange = renderHistorico;
  yearFilter.onchange = renderHistorico;
  renderHistoricoSemanal(weeklyRecords, yearFilter.value, monthFilter.value);
}

function renderHistoricoSemanal(records, year, month) {
  const wrap = document.getElementById("historicoSemanalList");
  if (!wrap) return;
  const weeks = records
    .filter((item) => item.year === year && item.month === month)
    .sort((a, b) => b.semana.localeCompare(a.semana));
  if (!weeks.length) {
    wrap.innerHTML = '<div class="empty-state">No hay cierres semanales guardados para este mes.</div>';
    return;
  }
  const rows = weeks.map((summary, index) => {
    const pedidos = STATE.completados.filter((pedido) => pedido.semana === summary.semana);
    const detalle = pedidos.length
      ? pedidos.map((pedido) => `<div class="pedido-row"><div><div class="p-cliente">${escapeHtml(pedido.cliente)}</div><div class="p-detalle">${pedido.detalle.map((item) => `${escapeHtml(item.tipo)} x${item.cantidad}`).join(", ")}</div></div><div class="mono">$${Number(pedido.montoCobrado || 0).toFixed(2)}</div></div>`).join("")
      : '<div class="empty-state">No hay pedidos completados registrados en esta semana.</div>';
    const utilidad = Number(summary.total || 0) - Number(summary.inversion || 0);
    return `<tr><th scope="row">${escapeHtml(summary.label)}</th><td data-label="Pedidos">${summary.pedidos}</td><td data-label="Ventas" class="mono">$${Number(summary.total).toFixed(2)}</td><td data-label="Inversión" class="mono">$${Number(summary.inversion).toFixed(2)}</td><td data-label="Utilidad"><span class="utilidad ${utilidad >= 0 ? "pos" : "neg"} mono">$${utilidad.toFixed(2)}</span></td><td data-label="Detalle"><button type="button" class="btn-ghost history-detail-toggle" aria-expanded="false" aria-controls="week-archive-detail-${index}" onclick="toggleWeeklyArchive(${index})">Ver detalle</button></td></tr><tr class="history-detail-row" id="week-archive-detail-${index}"><td colspan="6"><div class="history-week-detail">${detalle}</div></td></tr>`;
  }).join("");
  wrap.innerHTML = `<div class="history-table-wrap"><table class="history-table"><thead><tr><th>Semana (archivo)</th><th>Pedidos</th><th>Ventas</th><th>Inversión</th><th>Utilidad</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function toggleWeeklyArchive(index) {
  const detail = document.getElementById("week-archive-detail-" + index);
  const isOpen = detail.classList.toggle("open");
  const toggle = document.querySelector(`.history-detail-toggle[aria-controls="week-archive-detail-${index}"]`);
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.textContent = isOpen ? "Ocultar detalle" : "Ver detalle";
}

async function registrarCierreHistorico(fecha, index) {
  const input = document.getElementById("daily-invest-" + index);
  if (!input || input.value === "" || Number(input.value) < 0 || !Number.isFinite(Number(input.value))) {
    await showAppDialog({ title: "Inversión pendiente", message: "Escribe una inversión válida para cerrar este día.", confirmText: "Entendido" });
    return;
  }
  try {
    await postAndSync("guardarCierreDiario", { fecha, inversion: Number(input.value) });
  } catch (err) { onError(err); }
}
function toggleDay(i) {
  const detail = document.getElementById("day-detail-" + i);
  const isOpen = detail.classList.toggle("open");
  const toggle = document.querySelector(
    `.history-detail-toggle[aria-controls="day-detail-${i}"]`,
  );
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.textContent = isOpen ? "Ocultar detalle" : "Ver detalle";
}
