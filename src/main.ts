import './app.css';
import App from './App.svelte';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });
// Ask the browser not to evict the offline database when storage is low.
navigator.storage?.persist?.().catch(() => {});
export default new App({ target: document.getElementById('app')! });
