/* ==========================================================
   API — llamadas a la URL de implementación de Apps Script
   vía JSONP (etiqueta <script>), para evitar por completo el
   bloqueo de CORS que Apps Script no resuelve con fetch().
   ========================================================== */

function jsonpRequest(action, params = {}, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const callbackName =
      "tamalesCb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
    const script = document.createElement("script");
    let settled = false;
    let timer = null;

    const cleanup = () => {
      delete window[callbackName];
      script.remove();
      if (timer) clearTimeout(timer);
    };

    // Evita que una respuesta tardía (o duplicada) se procese dos veces,
    // y evita que la UI se quede colgada indefinidamente en "Creando…".
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          "La API tardó demasiado en responder. Revisa tu conexión e inténtalo de nuevo.",
        ),
      );
    }, timeoutMs);

    window[callbackName] = (response) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (response && response.ok) resolve(response.data);
      else
        reject(new Error((response && response.error) || "Error desconocido"));
    };

    const url = new URL(API_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callbackName);
    Object.entries(params).forEach(([k, v]) => {
      if (v == null) return;
      url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : v);
    });

    script.src = url.toString();
    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("No se pudo conectar con la API"));
    };
    document.body.appendChild(script);
  });
}

function apiGet(action, params = {}) {
  return jsonpRequest(action, params);
}
function apiPost(action, payload = {}) {
  return jsonpRequest(action, payload);
}

