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

function compactarDetalle(items) {
  const cantidades = new Map();
  (items || []).forEach((item) => {
    cantidades.set(item.tipo, (cantidades.get(item.tipo) || 0) + Number(item.cantidad || 0));
  });
  return [...cantidades].map(([tipo, cantidad]) => ({ tipo, cantidad }));
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

function getDayLabel(dayKey) {
  const date = new Date(`${dayKey}T12:00:00`);
  const weekdays = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${weekdays[date.getDay()]} ${String(date.getDate()).padStart(2, "0")} de ${months[date.getMonth()]}`;
}

function getTodayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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
    fechaOperativa: row.fecha_operativa || (row.created_at ? row.created_at.slice(0, 10) : ""),
    cliente: row.cliente,
    telefono: row.telefono || "",
    origen: row.origen || (row.telefono ? "cliente" : "panel"),
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
  const { data, error } = await sb.from("config").select("*").order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) {
    const defaultTipos = [
      { tipo: "Verde", precio: 15 },
      { tipo: "Rojo", precio: 15 },
      { tipo: "Dulce", precio: 15 },
      { tipo: "Rajas con queso", precio: 15 },
    ];
    const defaultBebidas = [
      { tipo: "Atole chico (500 ml)", precio: 0, activo: false },
      { tipo: "Atole grande (1 L)", precio: 0, activo: false },
    ];
    const { data: created, error: errInsert } = await sb
      .from("config")
      .insert({ tipos: defaultTipos, bebidas: defaultBebidas })
      .select()
      .single();
    if (errInsert) throw errInsert;
    return { tipos: created.tipos, bebidas: created.bebidas || defaultBebidas };
  }
  return { tipos: data.tipos || [], bebidas: data.bebidas || [] };
}

async function guardarConfig(tipos, bebidas) {
  const sb = getSbClient();
  sbCheck(sb);
  const { data } = await sb.from("config").select("id").order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (data?.id) {
    const { error } = await sb.from("config").update({ tipos, bebidas, updated_at: new Date().toISOString() }).eq("id", data.id);
    if (error) throw error;
  } else {
    const { error } = await sb.from("config").insert({ tipos, bebidas });
    if (error) throw error;
  }
}

async function getSemanaActiva() {
  const sb = getSbClient();
  sbCheck(sb);
  const { data } = await sb.from("semana_activa").select("semana").eq("id", 1).maybeSingle();
  return data?.semana || getWeekInfo(new Date()).key;
}

async function getEstadoOperativo() {
  const sb = getSbClient();
  sbCheck(sb);
  const { data, error } = await sb.from("semana_activa").select("fecha_operativa, tamales_abiertos, bebidas_abiertas").eq("id", 1).maybeSingle();
  if (error) throw error;
  const today = getTodayKey();
  return {
    fecha: data?.fecha_operativa === today ? data.fecha_operativa : today,
    tamalesAbiertos: Boolean(data?.tamales_abiertos && data?.fecha_operativa === today),
    bebidasAbiertas: Boolean(data?.bebidas_abiertas && data?.fecha_operativa === today),
  };
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
  let query = sb
    .from("pedidos")
    .select("id, created_at, semana, fecha_operativa, cliente, telefono, origen, detalle, cantidad_total, monto_esperado, monto_cobrado, estado, fecha_completado")
    .order("created_at", { ascending: false });
  if (filtroEstado) query = query.eq("estado", filtroEstado);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapPedidoFromDb);
}

async function listarPedidosDia(fecha) {
  const sb = getSbClient();
  sbCheck(sb);
  const { data, error } = await sb
    .from("pedidos")
    .select("created_at, semana, fecha_operativa, detalle")
    .eq("fecha_operativa", fecha);
  if (error) throw error;
  return (data || []).map(mapPedidoFromDb);
}

async function getInventarioSemana(fecha, pedidosList, configObj) {
  const sb = getSbClient();
  sbCheck(sb);
  const config = configObj || (await getConfig());
  const tipos = [
    ...(config.tipos || []),
    ...(config.bebidas || []).map((item) => ({ ...item, categoria: "bebida" })),
  ];

  const { data: invRows, error: errInv } = await sb
    .from("inventario")
    .select("tipo, cantidad_inicial")
    .eq("fecha_operativa", fecha)
    .eq("cerrado", false);
  if (errInv) throw errInv;

  const { data: holdRows, error: errHolds } = await sb
    .from("pedido_apartados")
    .select("detalle")
    .eq("fecha_operativa", fecha)
    .eq("estado", "Activo")
    .gt("vence_en", new Date().toISOString());
  if (errHolds) throw errHolds;

  const inicial = {};
  const inventarioDeHoy = new Set();
  (invRows || []).forEach((r) => { inicial[r.tipo] = Number(r.cantidad_inicial); inventarioDeHoy.add(r.tipo); });

  // Calcular vendido
  const pedidos = pedidosList || (await listarPedidosDia(fecha));
  const vendidos = {};
  pedidos.filter((p) => p.fechaOperativa === fecha).forEach((p) => {
    (p.detalle || []).forEach((d) => {
      vendidos[d.tipo] = (vendidos[d.tipo] || 0) + Number(d.cantidad || 0);
    });
  });

  const apartados = {};
  (holdRows || []).forEach((hold) => {
    (hold.detalle || []).forEach((d) => {
      apartados[d.tipo] = (apartados[d.tipo] || 0) + Number(d.cantidad || 0);
    });
  });

  return tipos.map(({ tipo }) => {
    // Todo tipo tiene inventario controlado. Si no existe una fila para la
    // semana, su cantidad inicial es cero; nunca se considera "ilimitado".
    const configurado = inventarioDeHoy.has(tipo);
    const cantidadInicial = Object.prototype.hasOwnProperty.call(inicial, tipo)
      ? inicial[tipo]
      : 0;
    const v = vendidos[tipo] || 0;
    const reservado = apartados[tipo] || 0;
    const disponible = Math.max(cantidadInicial - v - reservado, 0);
    const producto = tipos.find((item) => item.tipo === tipo);
    return { tipo, categoria: producto?.categoria || "tamal", cantidadInicial, vendido: v, reservado, disponible, configurado, inventarioHoy: configurado };
  });
}

async function guardarInventarioEnDb(fecha, semana, items, abrirTamales, abrirBebidas) {
  const sb = getSbClient();
  sbCheck(sb);
  if (items.length) {
    const { error } = await sb.rpc("guardar_inventario_diario", {
      p_fecha: fecha,
      p_semana: semana,
      p_items: items.map((item) => ({ tipo: item.tipo, cantidad: Number(item.cantidad) })),
      p_abrir_tamales: Boolean(abrirTamales),
      p_abrir_bebidas: Boolean(abrirBebidas),
    });
    if (error) throw error;
  }
}

async function cambiarEstadoPedidos(categoria, abierto) {
  const sb = getSbClient();
  sbCheck(sb);
  const { error } = await sb.rpc("cambiar_estado_pedidos_diarios_categoria", {
    p_categoria: categoria,
    p_abierto: Boolean(abierto),
  });
  if (error) throw error;
}

async function cerrarInventariosAnteriores() {
  const sb = getSbClient();
  sbCheck(sb);
  const { data, error } = await sb.rpc("cerrar_inventarios_anteriores");
  if (error) throw error;
  return Number(data || 0);
}

async function crearPedido(cliente, items) {
  const sb = getSbClient();
  sbCheck(sb);
  if (!cliente) throw new Error("Falta el nombre del cliente");
  if (!items || !items.length) throw new Error("El pedido no tiene tamales");

  const { data, error } = await sb.rpc("crear_pedido_panel", {
    p_cliente: cliente,
    p_detalle: compactarDetalle(items),
  });
  if (error) throw error;
  return data;
}

async function editarPedido(id, cliente, items) {
  const sb = getSbClient();
  sbCheck(sb);
  if (!id) throw new Error("Falta el id del pedido");
  if (!cliente) throw new Error("Falta el nombre del cliente");
  if (!items || !items.length) throw new Error("El pedido no tiene tamales");

  const { error: errUpd } = await sb.rpc("editar_pedido_panel", {
    p_id: id,
    p_cliente: cliente,
    p_detalle: compactarDetalle(items),
  });
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

async function eliminarPedidoEnDb(id, motivo) {
  const sb = getSbClient();
  sbCheck(sb);
  const { error } = await sb.rpc("cancelar_pedido_panel", { p_id: id, p_motivo: motivo });
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
  const { error } = await sb.rpc("cerrar_semana_panel", {
    p_semana: semanaActual,
    p_siguiente: semanaSiguiente,
    p_inversion: inversion == null || inversion === "" ? null : Number(inversion),
  });
  if (error) throw error;
  return { semanaCerrada: semanaActual, semanaNueva: semanaSiguiente };
}

async function obtenerCierres() {
  const sb = getSbClient();
  sbCheck(sb);
  const { data, error } = await sb.from("cierres").select("semana, inversion");
  if (error) throw error;
  return data || [];
}

async function obtenerResumenSemanal(pedidos, cierresData) {
  const completados = (pedidos || []).filter((p) => p.estado === "Completado");
  const map = {};
  completados.forEach((p) => {
    if (!map[p.semana]) map[p.semana] = { semana: p.semana, total: 0, pedidos: 0 };
    map[p.semana].total += Number(p.montoCobrado || 0);
    map[p.semana].pedidos += 1;
  });

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
  const [todos, semanaActual, config, cierresData, operativo] = await Promise.all([
    listarPedidos(),
    getSemanaActiva(),
    getConfig(),
    obtenerCierres(),
    getEstadoOperativo(),
  ]);
  const [inventario, resumenSemanal] = await Promise.all([
    getInventarioSemana(operativo.fecha, todos, config),
    obtenerResumenSemanal(todos, cierresData),
  ]);

  return {
    todos,
    completados: todos.filter((p) => p.estado === "Completado"),
    pendientes: todos.filter((p) => p.estado === "Pendiente"),
    resumenSemanal,
    config,
    inventario,
    semanaActual,
    semanaActualLabel: getWeekLabel(semanaActual),
    fechaOperativa: operativo.fecha,
    fechaOperativaLabel: getDayLabel(operativo.fecha),
    pedidosTamalesAbiertos: operativo.tamalesAbiertos,
    pedidosBebidasAbiertos: operativo.bebidasAbiertas,
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
      return await getInventarioSemana(params.fecha || (await getEstadoOperativo()).fecha);
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
      await eliminarPedidoEnDb(payload.id, payload.motivo);
      break;
    case "guardarConfig":
      await guardarConfig(payload.tipos, payload.bebidas || []);
      break;
    case "guardarInventario":
      await guardarInventarioEnDb(payload.fecha, payload.semana, payload.items, payload.abrirTamales, payload.abrirBebidas);
      break;
    case "cambiarEstadoPedidos":
      await cambiarEstadoPedidos(payload.categoria, payload.abierto);
      break;
    case "cerrarInventariosAnteriores":
      return await cerrarInventariosAnteriores();
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
  return { ok: true };
}
