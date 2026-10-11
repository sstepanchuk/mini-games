// The library as an app on the phone: the service worker keeps every file for offline use (sw.js),
// and the shelf tells how to install it ("Add to Home Screen" on iPhone, the install button elsewhere).
import { $, btn, root } from './dom.js';

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function registerWorker({ onUpdate }) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(new URL('sw.js', root), { scope: root.pathname, updateViaCache: 'none' }).then(reg => {
    // the page does not navigate any more (one page for everything), so ask for updates now and then
    const check = () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', check);
    setInterval(check, 30 * 60000);
  }, e => console.warn('service worker:', e));
  let had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) onUpdate(); had = true; });
}

// one line under the shelf: install the app, or how to do it on iPhone, or that it works offline
export function installHint() {
  const box = $('install');
  if (standalone()) { box.hidden = true; return; }
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) { box.textContent = 'Щоб грати без інтернету, додай Ігротеку на екран: «Поділитися» → «На екран „Додому“».'; box.hidden = false; }
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    box.replaceChildren('Ігротека може працювати як застосунок, навіть без інтернету. ');
    box.append(btn('Встановити', () => { e.prompt(); e.userChoice.finally(() => { box.hidden = true; }); }, 'btn ghost'));
    box.hidden = false;
  });
  addEventListener('appinstalled', () => { box.hidden = true; });
}

// ask the browser to keep our files even when space runs low (installed apps usually get it)
export const keepFiles = () => { try { navigator.storage.persist().catch(() => {}); } catch (e) {} };
