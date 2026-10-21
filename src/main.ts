import './app.css';
import App from './App.svelte';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

// After an update, a page that is still open may ask for a file the new version replaced. Reload once to pick up the new version.
function reloadOnce() {
  try { if (sessionStorage.getItem('reloaded-for-update')) return; sessionStorage.setItem('reloaded-for-update', '1'); } catch { /* ignore */ }
  navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {}).finally(() => location.reload());
}
window.addEventListener('vite:preloadError', (e) => { e.preventDefault(); reloadOnce(); });
window.addEventListener('unhandledrejection', (e) => { if (/dynamically imported module|Importing a module script failed/i.test(String(e.reason?.message ?? e.reason))) reloadOnce(); });
// Ask the browser not to evict the offline database when storage is low.
navigator.storage?.persist?.().catch(() => {});
export default new App({ target: document.getElementById('app')! });
