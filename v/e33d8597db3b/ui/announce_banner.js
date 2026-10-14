// The host's announcements (net/announcer.js): a banner at the top for everyone, and
// for the host a button to write one.
import { MAX_ANNOUNCEMENT } from '../net/host.js';

const SHOW_MS = 10000;

const STYLE = `
  #announcement { position: fixed; top: 96px; left: 50%; transform: translateX(-50%); z-index: 8; max-width: min(92vw, 640px);
    padding: 12px 20px; border-radius: 14px; background: rgba(0,0,0,.75); border: 2px solid #f5c542; color: #fff;
    font: 800 20px system-ui, sans-serif; text-align: center; pointer-events: none; transition: opacity .6s; }
  #announcement.gone { opacity: 0; }
  #announce-control { position: fixed; top: 52px; left: 50%; transform: translateX(-50%); z-index: 6; padding: 6px 14px;
    border-radius: 10px; border: 1px solid rgba(255,255,255,.5); background: rgba(30,60,140,.85); color: #fff;
    font: 700 13px system-ui, sans-serif; cursor: pointer; }
`;

function addBanner() {
  const banner = document.createElement('div');
  banner.id = 'announcement';
  banner.className = 'gone';
  document.body.appendChild(banner);
  let hideTimer = null;
  return text => {
    banner.textContent = `📢 ${text}`;
    banner.classList.remove('gone');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => banner.classList.add('gone'), SHOW_MS);
  };
}

function addHostControl(announcer, hostKey) {
  const control = document.createElement('button');
  control.id = 'announce-control';
  control.textContent = '📢 Anuncio';
  control.addEventListener('keydown', e => e.stopPropagation());
  control.addEventListener('click', () => {
    const text = prompt(`Anuncio para todos (hasta ${MAX_ANNOUNCEMENT} letras):`);
    if (text?.trim()) announcer.announceAsHost(text, hostKey).catch(err => console.warn('announcement failed:', err));
  });
  document.body.appendChild(control);
}

export function startAnnouncements(announcer, hostKey) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  announcer.onAnnouncement = addBanner();
  if (hostKey) addHostControl(announcer, hostKey);
}
