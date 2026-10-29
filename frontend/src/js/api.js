/* ==========================================================
   API.JS — Conexión a Supabase (Reemplazo de Apps Script)
   Mantiene la misma interfaz apiGet y apiPost para que todo
   el resto de los módulos continúen funcionando sin cambios.
   ========================================================== */

const MESES_MAP = [
  "enero","febrero","marzo","abril","mayo","junio","julio",
  "agosto","septiembre","octubre","noviembre","diciembre"
];

function getSbClient() {
  return window.SUPABASE_AUTH_CLIENT;
}

function sbCheck(client) {
  if (!client) {
    throw new Error("No hay sesión activa en Supabase o falta configuración.");
  }
}

/* ── Utilidades de Semana (idénticas a la versión de Apps Script) ── */

function getWeekInfo(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const weekNum = Math.ceil(day / 7);
  const key = year + "-" + String(month + 1).padStart(2, "0") + "-S" + weekNum;
  return { key, year, month, weekNum };
}

function getWeekLabel(weekKey) {
  const parts = String(weekKey || "").split("-");
  if (parts.length < 3) return weekKey;
  const year = parts[0];
  const month = Number(parts[1]) - 1;
  const weekNum = parts[2].replace("S", "");
  const nombreMes = MESES_MAP[month] || "";
  const mesCap = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
  return "Semana " + weekNum + " de " + mesCap + " " + year;
}

function getSemanaSiguiente(semana) {
  const parts = String(semana || "").split("-");
  if (parts.length < 3) return semana;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const weekNum = Number(parts[2].replace("S", ""));
  const startDate = new Date(year, month - 1, 1 + (weekNum - 1) * 7);
  const nextDate = new Date(startDate);
  nextDate.setDate(startDate.getDate() + 7);
  return getWeekInfo(nextDate).key;
}

/* ── Mapeo de Pedidos ── */

function mapPedidoFromDb(row) {
  return {
    id: row.id,
    fecha: row.created_at,
    semana: row.semana,
    cliente: row.cliente,
    detalle: Array.isArray(row.detalle) ? row.detalle : JSON.parse(row.detalle || "[]"),
    cantidadTotal: row.cantidad_total,
    montoEsperado: Number(row.monto_esperado),
    montoCobrado: row.monto_cobrado != null ? Number(row.monto_cobrado) : null,
    estado: row.estado,
    fechaCompletado: row.fecha_completado,
  };
}

/* ── Métodos de Base de Datos ── */

async function getConfig() {
  const sb = getSbClient();
  sbCheck(sb);
  const { data, error } = await sb.from("config").select("*").limit(1).maybeSingle();
  if (error) throw error;
  if (!data) {
    const defaultTipos = [
      { tipo: "Verde", precio: 15 },
      { tipo: "Rojo", precio: 15 },
      { tipo: "Dulce", precio: 15 },
      { tipo: "Rajas con queso", precio: 15 },
    ];
    const { data: created, error: errInsert } = await sb
      .from("config")
      .insert({ tipos: defaultTipos })
      .select()
      .single();
    if (errInsert) throw errInsert;
    return { tipos: created.tipos };
  }
  return { tipos: data.tipos || [] };
}

async function guardarConfig(tipos) {
  const sb = getSbClient();
  sbCheck(sb);
  const { data } = await sb.from("config").select("id").limit(1).maybeSingle();
  if (data?.id) {
    const { error } = await sb.from("config").update({ tipos }).eq("id", data.id);
    if (error) throw error;
  } else {
    const { error } = await sb.from("config").insert({ tipos });
    if (error) throw error;
  }
  return getConfig();
}

async function getSemanaActiva() {
  const sb = getSbClient();
  sbCheck(sb);
  const { data } = await sb.from("semana_activa").select("semana").eq("id", 1).maybeSingle();
  return data?.semana || getWeekInfo(new Date()).key;
}

async function guardarSemanaActiva(semana) {
  const sb = getSbClient();
  sbCheck(sb);
  const { error } = await sb
    .from("semana_activa")
    .upsert({ id: 1, semana }, { onConflict: "id" });
  if (error) throw error;
  return semana;
}

async function listarPedidos(filtroEstado) {
  const sb = getSbClient();
  sbCheck(sb);
  let query = sb.from("pedidos").select("*").order("created_at", { ascending: false });
  if (filtroEstado) query = query.eq("estado", filtroEstado);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapPedidoFromDb);
}

async function getInventarioSemana(semana, pedidosList, configObj) {
  const sb = getSbClient();
  sbCheck(sb);
  const config = configObj || (await getConfig());
  const tipos = config.tipos || [];

  const { data: invRows, error: errInv } = await sb
    .from("inventario")
    .select("tipo, cantidad_inicial")
    .eq("semana", semana);
  if (errInv) throw errInv;

  const inicial = {};
  (invRows || []).forEach((r) => { inicial[r.tipo] = Number(r.cantidad_inicial); });

  // Calcular vendido
  const pedidos = pedidosList || (await listarPedidos());
  const vendidos = {};
  pedidos.filter((p) => p.semana === semana).forEach((p) => {
    (p.detalle || []).forEach((d) => {
      vendidos[d.tipo] = (vendidos[d.tipo] || 0) + Number(d.cantidad || 0);
    });
  });

  return tipos.map(({ tipo }) => {
    const configurado = Object.prototype.hasOwnProperty.call(inicial, tipo);
    const cantidadInicial = configurado ? inicial[tipo] : null;
    const v = vendidos[tipo] || 0;
    const disponible = configurado ? Math.max(cantidadInicial - v, 0) : null;
    return { tipo, cantidadInicial, vendido: v, disponible, configurado };
  });
}

async function guardarInventario(semana, items) {
  const sb = getSbClient();
  sbCheck(sb);
  for (const item of items) {
    const { error } = await sb.from("inventario").upsert(
      { semana, tipo: item.tipo, cantidad_inicial: Number(item.cantidad) },
      { onConflict: "semana,tipo" }
    );
    if (error) throw error;
  }
  return getInventarioSemana(semana);
}

async function crearPedido(cliente, items) {
  const sb = getSbClient();
  sbCheck(sb);
  if (!cliente) throw new Error("Falta el nombre del cliente");
  if (!items || !items.length) throw new Error("El pedido no tiene tamales");

  const semana = await getSemanaActiva();
  const config = await getConfig();
  const inventario = await getInventarioSemana(semana, null, config);
  const invPorTipo = {};
  inventario.forEach((i) => { invPorTipo[i.tipo] = i; });

  items.forEach((item) => {
    const inv = invPorTipo[item.tipo];
    if (inv && inv.configurado && Number(item.cantidad) > inv.disponible) {
      throw new Error(`No hay suficiente inventario de "${item.tipo}". Disponible: ${inv.disponible}`);
    }
  });

  const precios = {};
  config.tipos.forEach((t) => { precios[t.tipo] = t.precio; });
  const cantidadTotal = items.reduce((s, i) => s + Number(i.cantidad || 0), 0);
  const montoEsperado = items.reduce((s, i) => s + Number(i.cantidad || 0) * (precios[i.tipo] || 0), 0);

  const { data, error } = await sb
    .from("pedidos")
    .insert({
      semana,
      cliente,
      detalle: items,
      cantidad_total: cantidadTotal,
      monto_esperado: montoEsperado,
      estado: "Pendiente",
    })
    .select()
    .single();

  if (error) throw error;
  return mapPedidoFromDb(data);
}

async function editarPedido(id, cliente, items) {
  const sb = getSbClient();
  sbCheck(sb);
  if (!id) throw new Error("Falta el id del pedido");
  if (!cliente) throw new Error("Falta el nombre del cliente");
  if (!items || !items.length) throw new Error("El pedido no tiene tamales");

  const { data: original, error: errGet } = await sb.from("pedidos").select("*").eq("id", id).single();
  if (errGet) throw errGet;
  if (original.estado !== "Pendiente") throw new Error("Solo se pueden editar pedidos pendientes");

  const detalleOriginal = Array.isArray(original.detalle) ? original.detalle : JSON.parse(original.detalle || "[]");
  const reservadoOriginal = {};
  detalleOriginal.forEach((d) => {
    reservadoOriginal[d.tipo] = (reservadoOriginal[d.tipo] || 0) + Number(d.cantidad);
  });

  const config = await getConfig();
  const inventario = await getInventarioSemana(original.semana, null, config);
  const invPorTipo = {};
  inventario.forEach((i) => { invPorTipo[i.tipo] = i; });

  items.forEach((item) => {
    const inv = invPorTipo[item.tipo];
    if (inv && inv.configurado) {
      const disponibleAjustado = inv.disponible + (reservadoOriginal[item.tipo] || 0);
      if (Number(item.cantidad) > disponibleAjustado) {
        throw new Error(`No hay suficiente inventario de "${item.tipo}". Disponible: ${disponibleAjustado}`);
      }
    }
  });

  const precios = {};
  config.tipos.forEach((t) => { precios[t.tipo] = t.precio; });
  const cantidadTotal = items.reduce((s, i) => s + Number(i.cantidad || 0), 0);
  const montoEsperado = items.reduce((s, i) => s + Number(i.cantidad || 0) * (precios[i.tipo] || 0), 0);

  const { error: errUpd } = await sb.from("pedidos").update({
    cliente,
    detalle: items,
    cantidad_total: cantidadTotal,
    monto_esperado: montoEsperado,
  }).eq("id", id);
  if (errUpd) throw errUpd;
}

async function completarPedido(id, montoCobrado) {
  const sb = getSbClient();
  sbCheck(sb);
  const { error } = await sb.from("pedidos").update({
    monto_cobrado: Number(montoCobrado),
    estado: "Completado",
    fecha_completado: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
}

async function reabrirPedido(id) {
  const sb = getSbClient();
  sbCheck(sb);
  const { error } = await sb.from("pedidos").update({
    monto_cobrado: null,
    estado: "Pendiente",
    fecha_completado: null,
  }).eq("id", id);
  if (error) throw error;
}

async function eliminarPedido(id) {
  const sb = getSbClient();
  sbCheck(sb);
  const { error } = await sb.from("pedidos").delete().eq("id", id);
  if (error) throw error;
}

async function guardarInversion(semana, inversion) {
  const sb = getSbClient();
  sbCheck(sb);
  const { error } = await sb.from("cierres").upsert(
    { semana, inversion: Number(inversion), updated_at: new Date().toISOString() },
    { onConflict: "semana" }
  );
  if (error) throw error;
}

async function cerrarSemana(semana, inversion) {
  const sb = getSbClient();
  sbCheck(sb);
  const semanaActual = semana || (await getSemanaActiva());
  const semanaSiguiente = getSemanaSiguiente(semanaActual);

  if (inversion != null && inversion !== "") {
    await guardarInversion(semanaActual, Number(inversion));
  }

  const { tipos } = await getConfig();
  for (const { tipo } of tipos) {
    await sb.from("inventario").upsert(
      { semana: semanaSiguiente, tipo, cantidad_inicial: 0 },
      { onConflict: "semana,tipo" }
    );
  }

  await guardarSemanaActiva(semanaSiguiente);
  return { semanaCerrada: semanaActual, semanaNueva: semanaSiguiente };
}

async function obtenerResumenSemanal(pedidos) {
  const sb = getSbClient();
  sbCheck(sb);
  const completados = (pedidos || (await listarPedidos())).filter((p) => p.estado === "Completado");
  const map = {};
  completados.forEach((p) => {
    if (!map[p.semana]) map[p.semana] = { semana: p.semana, total: 0, pedidos: 0 };
    map[p.semana].total += Number(p.montoCobrado || 0);
    map[p.semana].pedidos += 1;
  });

  const { data: cierresData } = await sb.from("cierres").select("*");
  const cierres = {};
  (cierresData || []).forEach((c) => { cierres[c.semana] = { inversion: Number(c.inversion) }; });

  return Object.values(map)
    .map((r) => {
      const c = cierres[r.semana];
      const inversion = c ? c.inversion : null;
      const utilidad = inversion != null ? r.total - inversion : null;
      return {
        semana: r.semana,
        label: getWeekLabel(r.semana),
        total: r.total,
        pedidos: r.pedidos,
        inversion,
        utilidad,
        registrada: !!c,
      };
    })
    .sort((a, b) => a.semana.localeCompare(b.semana));
}

/* ── Dashboard Completo ── */

async function getDashboardData() {
  const todos = await listarPedidos();
  const semanaActual = await getSemanaActiva();
  const config = await getConfig();
  const inventario = await getInventarioSemana(semanaActual, todos, config);
  const resumenSemanal = await obtenerResumenSemanal(todos);

  return {
    todos,
    completados: todos.filter((p) => p.estado === "Completado"),
    pendientes: todos.filter((p) => p.estado === "Pendiente"),
    resumenSemanal,
    config,
    inventario,
    semanaActual,
    semanaActualLabel: getWeekLabel(semanaActual),
  };
}

/* ── Rutas Expuestas al Frontend (apiGet / apiPost) ── */

async function apiGet(action, params = {}) {
  switch (action) {
    case "dashboard":
      return await getDashboardData();
    case "config":
      return await getConfig();
    case "pedidos":
      return await listarPedidos(params.estado || null);
    case "inventario":
      return await getInventarioSemana(params.semana || (await getSemanaActiva()));
    default:
      throw new Error("Acción GET no reconocida: " + action);
  }
}

async function apiPost(action, payload = {}) {
  switch (action) {
    case "crearPedido":
      await crearPedido(payload.cliente, payload.items);
      break;
    case "editarPedido":
      await editarPedido(payload.id, payload.cliente, payload.items);
      break;
    case "completarPedido":
      await completarPedido(payload.id, payload.montoCobrado);
      break;
    case "reabrirPedido":
      await reabrirPedido(payload.id);
      break;
    case "eliminarPedido":
      await eliminarPedido(payload.id);
      break;
    case "guardarConfig":
      await guardarConfig(payload.tipos);
      break;
    case "guardarInventario":
      await guardarInventario(payload.semana, payload.items);
      break;
    case "guardarInversion":
      await guardarInversion(payload.semana, payload.inversion);
      break;
    case "cerrarSemana":
      await cerrarSemana(payload.semana, payload.inversion);
      break;
    default:
      throw new Error("Acción POST no reconocida: " + action);
  }

  // Devolver dashboard completo actualizado (idéntico al router de Apps Script)
  return await getDashboardData();
}
