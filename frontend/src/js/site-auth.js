/* ==========================================================
   SITE-AUTH.JS — Autenticación con Supabase (Patrón Agendas)
   ========================================================== */

const siteAuthConfig = window.SUPABASE_CONFIG || {};
const siteAuthReady = Boolean(
  window.supabase?.createClient &&
  siteAuthConfig.url &&
  siteAuthConfig.anonKey &&
  !siteAuthConfig.url.includes("TU-PROYECTO") &&
  !siteAuthConfig.anonKey.includes("TU-ANON-KEY")
);

// Crear la pantalla de login idéntica al diseño del ecosistema Agendas
const siteAuthScreen = document.createElement("section");
siteAuthScreen.className = "site-auth-screen";
siteAuthScreen.id = "siteAuthScreen";
siteAuthScreen.setAttribute("aria-labelledby", "siteAuthTitle");
siteAuthScreen.innerHTML = `
  <div class="site-auth-card">
    <div class="site-auth-logo">🫔</div>
    <h1 id="siteAuthTitle">Iniciar sesión</h1>
    <p class="site-auth-page-name">TAMALES — PANEL DE CONTROL</p>
    
    <div id="siteAuthLoginPanel">
      <form class="site-auth-form" id="siteAuthLoginForm" autocomplete="on">
        <label>Correo electrónico
          <input id="siteAuthLoginEmail" type="email" autocomplete="username email" required placeholder="correo@ejemplo.com" />
        </label>
        <label>Contraseña
          <input id="siteAuthLoginPassword" type="password" autocomplete="current-password" required placeholder="••••••••" />
        </label>
        <button class="site-auth-submit" type="submit">Iniciar sesión</button>
      </form>
      <button class="site-auth-link" id="siteAuthForgot" type="button">Olvidé mi contraseña</button>
    </div>

    <div id="siteAuthRequestPanel" hidden>
      <p style="font-size: 13px; color: var(--carbon-60); text-align: center; margin-bottom: 16px;">
        Escribe tu correo y te enviaremos un enlace para cambiar tu contraseña.
      </p>
      <form class="site-auth-form" id="siteAuthRequestForm" autocomplete="off">
        <label>Correo electrónico
          <input id="siteAuthRequestEmail" type="email" autocomplete="email" required placeholder="correo@ejemplo.com" />
        </label>
        <button class="site-auth-submit" type="submit">Enviar enlace</button>
      </form>
      <button class="site-auth-link" id="siteAuthRequestBack" type="button">Volver al inicio de sesión</button>
    </div>

    <div id="siteAuthUpdatePanel" hidden>
      <p style="font-size: 13px; color: var(--carbon-60); text-align: center; margin-bottom: 16px;">
        Escribe y confirma tu nueva contraseña.
      </p>
      <form class="site-auth-form" id="siteAuthUpdateForm" autocomplete="off">
        <label>Nueva contraseña
          <input id="siteAuthNewPassword" type="password" autocomplete="new-password" required placeholder="••••••••" />
        </label>
        <label>Confirmar contraseña
          <input id="siteAuthConfirmPassword" type="password" autocomplete="new-password" required placeholder="••••••••" />
        </label>
        <button class="site-auth-submit" type="submit">Guardar contraseña</button>
      </form>
    </div>

    <p class="site-auth-status" id="siteAuthStatus" role="status"></p>
  </div>`;

document.body.prepend(siteAuthScreen);

const byId = (id) => document.getElementById(id);
const loginPanel = byId("siteAuthLoginPanel");
const requestPanel = byId("siteAuthRequestPanel");
const updatePanel = byId("siteAuthUpdatePanel");
const loginForm = byId("siteAuthLoginForm");
const requestForm = byId("siteAuthRequestForm");
const updateForm = byId("siteAuthUpdateForm");
const statusEl = byId("siteAuthStatus");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function showPanel(panelName) {
  loginPanel.hidden = panelName !== "login";
  requestPanel.hidden = panelName !== "request";
  updatePanel.hidden = panelName !== "update";
  setStatus("");
}

function updateSession(session) {
  if (session) {
    document.body.classList.remove("site-auth-pending", "site-auth-required");
    siteAuthScreen.hidden = true;
    if (typeof cargarTodo === "function") {
      cargarTodo();
    }
  } else {
    document.body.classList.remove("site-auth-pending");
    document.body.classList.add("site-auth-required");
    siteAuthScreen.hidden = false;
    showPanel("login");
  }
}

// ── Iniciar cliente de Supabase ──────────────────────────────────────────
if (!siteAuthReady) {
  document.body.classList.remove("site-auth-pending");
  document.body.classList.add("site-auth-required");
  setStatus("Falta configurar url y anonKey en src/js/supabase-config.js", true);
} else {
  window.SUPABASE_AUTH_CLIENT = window.supabase.createClient(
    siteAuthConfig.url,
    siteAuthConfig.anonKey,
    {
      auth: {
        // Mantiene la sesión solo en esta pestaña: sobrevive a recargas y
        // desaparece al cerrarla.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "tamales-dashboard-auth",
        storage: window.sessionStorage,
      },
    }
  );

  // Escuchar cambios de sesión
  window.SUPABASE_AUTH_CLIENT.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      showPanel("update");
    }
    updateSession(session);
  });

  // Recuperar sesión activa
  window.SUPABASE_AUTH_CLIENT.auth.getSession().then(({ data, error }) => {
    if (error) setStatus("No se pudo recuperar la sesión.", true);
    updateSession(data?.session);
  });
}

// ── Event listeners de formularios ──────────────────────────────────────
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submit = loginForm.querySelector("button[type=submit]");
  const email = byId("siteAuthLoginEmail").value.trim();
  const password = byId("siteAuthLoginPassword").value;

  submit.disabled = true;
  setStatus("Verificando...");

  const { error } = await window.SUPABASE_AUTH_CLIENT.auth.signInWithPassword({
    email,
    password,
  });

  submit.disabled = false;
  if (error) {
    setStatus("Correo o contraseña incorrectos.", true);
  } else {
    setStatus("");
  }
});

requestForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submit = requestForm.querySelector("button[type=submit]");
  submit.disabled = true;
  const email = byId("siteAuthRequestEmail").value.trim();

  const { error } = await window.SUPABASE_AUTH_CLIENT.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href.split("#")[0],
  });

  submit.disabled = false;
  if (error) {
    setStatus(error.message, true);
  } else {
    setStatus("Revisa tu correo para cambiar la contraseña.");
    requestForm.reset();
  }
});

updateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = byId("siteAuthNewPassword").value;
  const confirm = byId("siteAuthConfirmPassword").value;

  if (password !== confirm) {
    return setStatus("Las contraseñas no coinciden.", true);
  }

  const submit = updateForm.querySelector("button[type=submit]");
  submit.disabled = true;

  const { error } = await window.SUPABASE_AUTH_CLIENT.auth.updateUser({ password });
  submit.disabled = false;

  if (error) {
    return setStatus(error.message, true);
  }

  updateForm.reset();
  setStatus("Contraseña actualizada. Ya puedes continuar.");
  const { data } = await window.SUPABASE_AUTH_CLIENT.auth.getSession();
  updateSession(data?.session);
});

byId("siteAuthForgot").onclick = () => showPanel("request");
byId("siteAuthRequestBack").onclick = () => showPanel("login");

// Botón de cerrar sesión
document.addEventListener("DOMContentLoaded", () => {
  const logoutBtn = byId("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      if (window.SUPABASE_AUTH_CLIENT) {
        await window.SUPABASE_AUTH_CLIENT.auth.signOut();
      }
    });
  }
});
