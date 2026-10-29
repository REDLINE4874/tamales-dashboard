// Registro inicial de PWA. No almacena archivos todavía para evitar servir
// versiones antiguas del dashboard o datos de Supabase fuera de línea.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
