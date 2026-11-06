(() => {
  const config = window.SUPABASE_CONFIG || {};
  const client = window.supabase?.createClient && config.url && config.anonKey
    ? window.supabase.createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  const $ = (id) => document.getElementById(id);
  const cart = new Map();
  let menu = [];
  let activeCategory = "todos";
  let searchTerm = "";
  let ordersOpen = false;
  let tamalesOpen = false;
  let drinksOpen = false;
  let holdId = null;
  let expiry = 0;
  let timerId = null;
  let lastLookup = null;
  const contactKey = "tamales-contacto-cliente";
  const lastFolioKey = "tamales-ultimo-folio";

  function setOrderNav(text, state = "closed") {
    const badge = $("orderStatusBadge");
    $("menuMessage").textContent = text;
    badge.classList.toggle("is-open", state === "open");
    badge.classList.toggle("is-loading", state === "loading");
  }

  function showClosedNotice(title, text) {
    ordersOpen = false;
    tamalesOpen = false;
    drinksOpen = false;
    cart.clear();
    updateCart();
    $("menuContent").hidden = true;
    $("customerIntro").hidden = true;
    $("closedNotice").hidden = false;
    $("closedNoticeTitle").textContent = title;
    $("closedNoticeMessage").textContent = text;
  }

  async function loadMenu() {
    if (!client) {
      setOrderNav("No disponible");
      showClosedNotice("No pudimos consultar los pedidos", "Revisa tu conexión e inténtalo de nuevo.");
      return;
    }
    $("refreshMenu").disabled = true;
    setOrderNav("Consultando…", "loading");
    const { data, error } = await client.rpc("menu_publico");
    $("refreshMenu").disabled = false;
    if (error) {
      setOrderNav("No disponible");
      showClosedNotice("No pudimos consultar los pedidos", "Inténtalo de nuevo en un momento.");
      return;
    }
    const dateLabel = formatDate(data?.fecha);
    const tipos = Array.isArray(data?.tipos) ? data.tipos : [];
    const bebidas = Array.isArray(data?.bebidas) ? data.bebidas : [];
    // Compatibility with the global open flag returned by earlier menu_publico versions.
    tamalesOpen = data?.tamales_abiertos === undefined ? Boolean(data?.abierto) : Boolean(data.tamales_abiertos);
    drinksOpen = data?.bebidas_abiertos === undefined ? Boolean(data?.abierto && bebidas.length) : Boolean(data.bebidas_abiertos);
    ordersOpen = tamalesOpen || drinksOpen;
    activeCategory = tamalesOpen && drinksOpen ? "todos" : tamalesOpen ? "tamal" : "bebida";
    if (!ordersOpen) {
      menu = [];
      setOrderNav("Pedidos cerrados");
      showClosedNotice("Por ahora no estamos tomando pedidos", "Vuelve a consultar más tarde para ver el menú y la disponibilidad.");
      return;
    }
    menu = [
      ...(tamalesOpen ? tipos.map((item) => ({ ...item, categoria: "tamal" })) : []),
      ...(drinksOpen ? bebidas.map((item) => ({ ...item, categoria: "bebida" })) : []),
    ];
    setOrderNav(tamalesOpen && drinksOpen ? "Pedidos abiertos" : tamalesOpen ? "Tamales disponibles" : "Bebidas disponibles", "open");
    $("menuDate").textContent = dateLabel;
    $("customerIntro").hidden = false;
    $("closedNotice").hidden = true;
    $("menuContent").hidden = false;
    $("menuEmpty").textContent = menu.length
      ? "No encontramos productos con esa búsqueda."
      : "No hay productos configurados para esta categoría. Revisa el inventario y la configuración del panel.";
    renderMenu();
  }

  function renderMenu() {
    const matchesSearch = (item) => normalize(item.tipo).includes(normalize(searchTerm));
    const tamales = menu.filter((item) => item.categoria === "tamal" && matchesSearch(item));
    const bebidas = menu.filter((item) => item.categoria === "bebida" && matchesSearch(item));
    const showTamales = activeCategory !== "bebida" && tamales.length > 0;
    const showDrinks = activeCategory !== "tamal" && bebidas.length > 0;
    $("tamalesSection").hidden = !showTamales;
    $("drinksSection").hidden = !showDrinks;
    $("menuEmpty").hidden = showTamales || showDrinks;
    $("menuList").innerHTML = renderItems(tamales);
    $("drinksList").innerHTML = renderItems(bebidas);
    document.querySelectorAll(".category-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.category === activeCategory));
    document.querySelectorAll('.category-chip[data-category="tamal"]').forEach((chip) => { chip.hidden = !tamalesOpen; });
    document.querySelectorAll('.category-chip[data-category="bebida"]').forEach((chip) => { chip.hidden = !drinksOpen; });
    document.querySelectorAll('.category-chip[data-category="todos"]').forEach((chip) => { chip.hidden = !(tamalesOpen && drinksOpen); });
    updateCart();
    bindQuantityControls();
  }

  function renderItems(items) {
    const html = items.map((item) => {
      const qty = cart.get(item.tipo) || 0;
      const stock = Number(item.disponible) || 0;
      const canOrder = (item.categoria === "bebida" ? drinksOpen : tamalesOpen) && stock > 0;
      const image = item.categoria === "bebida" ? "icons/menu-atole.svg" : "icons/menu-tamal.svg";
      const action = qty
        ? `<div class="quantity-control"><button type="button" data-delta="-1" data-tipo="${escapeAttr(item.tipo)}" aria-label="Quitar ${escapeAttr(item.tipo)}">−</button><span>${qty}</span><button type="button" data-delta="1" data-tipo="${escapeAttr(item.tipo)}" aria-label="Agregar ${escapeAttr(item.tipo)}" ${!canOrder || qty >= stock ? "disabled" : ""}>+</button></div>`
        : `<button class="add-product" type="button" data-delta="1" data-tipo="${escapeAttr(item.tipo)}" aria-label="Agregar ${escapeAttr(item.tipo)}" ${!canOrder ? "disabled" : ""}>+</button>`;
      const inventoryToday = item.inventario_hoy !== false;
      const meta = !inventoryToday ? "Inventario de hoy pendiente" : stock ? `${stock} disponibles` : "Agotado";
      const metaClass = inventoryToday && stock ? "is-available" : "is-sold-out";
      return `<article class="menu-item"><div class="food-thumb ${item.categoria === "bebida" ? "food-thumb--drink" : ""}"><img src="${image}" alt="" loading="lazy"></div><div class="product-info"><div class="menu-name">${escapeHtml(item.tipo)}</div><div class="menu-meta ${metaClass}">${meta}</div><div class="menu-price">$${Number(item.precio).toFixed(2)}</div></div>${action}</article>`;
    }).join("");
    return html;
  }

  function bindQuantityControls() {
    document.querySelectorAll(".menu-list button[data-delta]").forEach((button) => button.addEventListener("click", () => {
      const tipo = button.dataset.tipo;
      const next = (cart.get(tipo) || 0) + Number(button.dataset.delta);
      if (next > 0) cart.set(tipo, next); else cart.delete(tipo);
      renderMenu();
    }));
  }

  function updateCart() {
    const count = [...cart.values()].reduce((sum, qty) => sum + qty, 0);
    const total = menu.reduce((sum, item) => sum + (cart.get(item.tipo) || 0) * Number(item.precio), 0);
    $("cartItemCount").textContent = count ? `${count} ${count === 1 ? "artículo" : "artículos"}` : "Tu carrito";
    $("cartSummary").textContent = `$${total.toFixed(2)}`;
    $("startCheckout").disabled = count === 0;
    $("cartBar").hidden = count === 0;
  }

  async function startCheckout() {
    const button = $("startCheckout"); button.disabled = true; button.textContent = "Apartando…";
    const detalle = [...cart].map(([tipo, cantidad]) => ({ tipo, cantidad }));
    const { data, error } = await client.rpc("crear_apartado_publico", { p_detalle: detalle });
    button.innerHTML = 'Continuar <span aria-hidden="true">→</span>';
    if (error) { await loadMenu(); button.disabled = cart.size === 0; alert(error.message || "No se pudieron apartar los tamales. Actualiza el menú e intenta de nuevo."); return; }
    holdId = data.id; expiry = Date.parse(data.vence_en);
    $("checkoutSummary").innerHTML = [...cart].map(([tipo, qty]) => {
      const item = menu.find((entry) => entry.tipo === tipo);
      return `<div>${qty} × ${escapeHtml(tipo)} <strong>$${(qty * Number(item?.precio || 0)).toFixed(2)}</strong></div>`;
    }).join("") + `<div><b>Total</b><strong>$${menu.reduce((sum, item) => sum + (cart.get(item.tipo) || 0) * Number(item.precio), 0).toFixed(2)}</strong></div>`;
    try {
      const contact = JSON.parse(localStorage.getItem(contactKey) || "{}");
      $("customerName").value = contact.name || ""; $("customerPhone").value = contact.phone || "";
    } catch { localStorage.removeItem(contactKey); }
    $("checkout").hidden = false; $("startCheckout").closest(".menu-card").hidden = true;
    $("refreshMenu").hidden = true;
    $("checkout").scrollIntoView({ behavior: "smooth", block: "center" });
    updateTimer(); timerId = window.setInterval(updateTimer, 1000);
  }

  function rememberContact() {
    try {
      localStorage.setItem(contactKey, JSON.stringify({
        name: $("customerName").value.trim(),
        phone: $("customerPhone").value.trim(),
      }));
    } catch {}
  }

  function formatDate(value) {
    const date = value ? new Date(`${value}T12:00:00`) : new Date();
    const weekdays = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return `${weekdays[date.getDay()]} ${String(date.getDate()).padStart(2, "0")} de ${months[date.getMonth()]}`;
  }

  function normalize(value) {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function updateTimer() {
    const seconds = Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
    $("timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    if (!seconds) { clearInterval(timerId); $("submitOrder").disabled = true; $("checkoutMessage").textContent = "Venció el apartado. Regresa al menú para revisar la disponibilidad."; }
  }

  async function cancelHold() {
    if (holdId) await client.rpc("cancelar_apartado_publico", { p_id: holdId });
    holdId = null; clearInterval(timerId); $("checkout").hidden = true; $("menuList").closest(".menu-card").hidden = false;
    $("refreshMenu").hidden = false;
    await loadMenu();
  }

  async function lookupOrder(event) {
    event.preventDefault();
    const folio = $("lookupFolio").value.trim().toUpperCase();
    const phone = $("lookupPhone").value.trim();
    lastLookup = { folio, phone };
    await loadOrderStatus(folio, phone);
  }

  async function loadOrderStatus(folio, phone) {
    const button = $("lookupOrderButton");
    const result = $("orderLookupResult");
    const details = $("lookupOrderDetails");
    $("cancelCustomerOrder").hidden = true;
    $("lookupCancelConfirm").hidden = true;
    details.hidden = true;
    button.disabled = true;
    result.textContent = "Consultando pedido…";
    result.classList.remove("is-cancelled", "is-error");
    if (!client) {
      button.disabled = false;
      result.textContent = "No podemos consultar el pedido en este momento.";
      result.classList.add("is-error");
      return;
    }
    const { data, error } = await client.rpc("consultar_estado_pedido", { p_folio: folio, p_telefono: phone });
    button.disabled = false;
    if (error) {
      result.textContent = error.message || "No encontramos un pedido con esos datos.";
      result.classList.add("is-error");
      return;
    }
    const estado = data.estado === "Cancelado" ? "Cancelado" : data.estado === "Completado" ? "Completado" : "Recibido · pendiente";
    result.textContent = data.estado === "Cancelado"
      ? `Tu pedido fue cancelado. ${data.motivo || ""}`.trim()
      : data.estado === "Completado" ? "Tu pedido aparece como completado." : "Recibimos tu pedido y sigue pendiente.";
    result.classList.toggle("is-cancelled", data.estado === "Cancelado");
    const lines = Array.isArray(data.detalle) ? data.detalle : [];
    details.innerHTML = `<div class="lookup-detail-head"><strong>Pedido ${escapeHtml(data.folio || folio)}</strong><span class="lookup-state ${data.estado === "Cancelado" ? "is-cancelled" : data.estado === "Completado" ? "is-complete" : "is-pending"}">${escapeHtml(estado)}</span></div><ul>${lines.map((line) => `<li><span>${Number(line.cantidad) || 0} × ${escapeHtml(line.tipo || "Producto")}</span><strong>$${((Number(line.cantidad) || 0) * (Number(line.precio) || 0)).toFixed(2)}</strong></li>`).join("") || "<li>Detalle no disponible</li>"}</ul><div class="lookup-detail-total"><span>${Number(data.cantidad_total) || lines.reduce((sum, line) => sum + (Number(line.cantidad) || 0), 0)} productos</span><strong>Total $${Number(data.monto_esperado || 0).toFixed(2)}</strong></div>`;
    details.hidden = false;
    $("cancelCustomerOrder").hidden = !data.puede_cancelar;
  }

  async function cancelCustomerOrder() {
    if (!lastLookup || !client) return;
    const button = $("confirmCustomerCancel");
    button.disabled = true;
    const { error } = await client.rpc("cancelar_pedido_cliente", {
      p_folio: lastLookup.folio,
      p_telefono: lastLookup.phone,
    });
    button.disabled = false;
    if (error) {
      $("orderLookupResult").textContent = error.message || "No pudimos cancelar el pedido. Actualiza el estado e intenta de nuevo.";
      $("orderLookupResult").classList.add("is-error");
      return;
    }
    await loadOrderStatus(lastLookup.folio, lastLookup.phone);
  }

  $("orderForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!holdId || Date.now() >= expiry) return updateTimer();
    const name = $("customerName").value.trim(); const phone = $("customerPhone").value.trim();
    const button = $("submitOrder"); button.disabled = true; button.textContent = "Enviando pedido…";
    const { data, error } = await client.rpc("confirmar_apartado_publico", { p_id: holdId, p_cliente: name, p_telefono: phone });
    button.disabled = false; button.textContent = "Enviar mi pedido";
    if (error) { $("checkoutMessage").textContent = error.message || "No pudimos confirmar el pedido. Revisa los datos e intenta otra vez."; return; }
    try { localStorage.setItem(contactKey, JSON.stringify({ name, phone })); } catch {}
    holdId = null; clearInterval(timerId); $("checkout").hidden = true; $("success").hidden = false;
    $("orderFolio").textContent = data.folio;
    $("lookupFolio").value = data.folio;
    $("lookupPhone").value = phone;
    try { localStorage.setItem(lastFolioKey, data.folio); } catch {}
    $("success").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]); }
  function escapeAttr(value) { return escapeHtml(value); }
  $("startCheckout").addEventListener("click", startCheckout);
  $("menuSearch").addEventListener("input", (event) => { searchTerm = event.target.value.trim(); renderMenu(); });
  document.querySelectorAll(".category-chip").forEach((chip) => chip.addEventListener("click", () => { activeCategory = chip.dataset.category; renderMenu(); }));
  $("customerName").addEventListener("change", rememberContact);
  $("customerPhone").addEventListener("change", rememberContact);
  $("refreshMenu").addEventListener("click", loadMenu);
  $("refreshClosedMenu").addEventListener("click", loadMenu);
  $("cancelHold").addEventListener("click", cancelHold);
  $("orderLookupForm").addEventListener("submit", lookupOrder);
  $("cancelCustomerOrder").addEventListener("click", () => { $("lookupCancelConfirm").hidden = false; });
  $("keepCustomerOrder").addEventListener("click", () => { $("lookupCancelConfirm").hidden = true; });
  $("confirmCustomerCancel").addEventListener("click", cancelCustomerOrder);
  $("openOrderLookup").addEventListener("click", () => $("orderLookupDialog").showModal());
  $("closeOrderLookup").addEventListener("click", () => $("orderLookupDialog").close());
  $("newOrder").addEventListener("click", () => { $("success").hidden = true; $("menuList").closest(".menu-card").hidden = false; $("refreshMenu").hidden = false; cart.clear(); loadMenu(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  try {
    const savedContact = JSON.parse(localStorage.getItem(contactKey) || "{}");
    $("lookupPhone").value = savedContact.phone || "";
    const lastFolio = localStorage.getItem(lastFolioKey) || "";
    if (lastFolio) {
      $("lookupFolio").value = lastFolio;
    }
  } catch {}
  loadMenu();
  window.setInterval(() => {
    if (!$("checkout").hidden || !$("success").hidden) return;
    loadMenu();
  }, 20000);
})();
