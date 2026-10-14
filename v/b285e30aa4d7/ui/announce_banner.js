// The host's announcements (net/announcer.js): a banner at the top for everyone, and
// for the host a button that opens a small composer (quick phrases or free text).
// No browser prompt(): it freezes the page, and the game's music with it.
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
  #announce-composer { position: fixed; top: 92px; left: 50%; transform: translateX(-50%); z-index: 9; width: min(92vw, 440px);
    padding: 12px; border-radius: 14px; background: rgba(18,18,28,.95); border: 1px solid rgba(255,255,255,.2);
    display: flex; flex-direction: column; gap: 8px; font: 14px system-ui, sans-serif; color: #fff; }
  #announce-composer[hidden] { display: none; }
  #announce-composer .presets { display: flex; flex-wrap: wrap; gap: 6px; }
  #announce-composer .presets button { padding: 5px 9px; border-radius: 9px; border: 1px solid rgba(255,255,255,.3);
    background: rgba(255,255,255,.06); color: #fff; font: 12px system-ui, sans-serif; cursor: pointer; }
  #announce-composer form { display: flex; gap: 6px; }
  #announce-composer input { flex: 1; min-width: 0; font: 16px system-ui, sans-serif; padding: 8px 10px; border-radius: 10px;
    border: 1px solid rgba(255,255,255,.35); background: rgba(0,0,0,.4); color: #fff; outline: none; }
  #announce-composer .send { padding: 0 14px; border-radius: 10px; border: none; background: #2f6fd6; color: #fff; font: 700 14px system-ui, sans-serif; }
  #announce-composer .count { font: 11px system-ui, sans-serif; color: rgba(255,255,255,.5); text-align: right; }
`;

const PRESETS = [
  '¡Bienvenidos! Esperen en los jardines',
  '¡En 1 minuto abrimos el castillo!',
  '¡Castillo abierto, a jugar!',
  'Todos al castillo',
  '¡Gracias por venir!',
];

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
  const composer = document.createElement('div');
  composer.id = 'announce-composer';
  composer.hidden = true;
  composer.innerHTML = '<div class="presets"></div>'
    + `<form><input type="text" maxlength="${MAX_ANNOUNCEMENT}" enterkeyhint="send" autocomplete="off" placeholder="Escribí un anuncio para todos">`
    + '<button type="submit" class="send">Enviar</button></form><div class="count"></div>';
  const input = composer.querySelector('input');
  const count = composer.querySelector('.count');
  const showCount = () => { count.textContent = `${input.value.length}/${MAX_ANNOUNCEMENT}`; };

  const send = text => {
    if (!text.trim()) return;
    announcer.announceAsHost(text, hostKey).catch(err => console.warn('announcement failed:', err));
    composer.hidden = true;
    input.blur();
  };
  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = preset;
    button.addEventListener('click', () => send(preset));
    composer.querySelector('.presets').appendChild(button);
  }
  composer.querySelector('form').addEventListener('submit', e => { e.preventDefault(); send(input.value); });
  input.addEventListener('input', showCount);
  // keys typed here stay out of the game; Escape closes
  for (const node of [control, composer]) {
    node.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') composer.hidden = true; });
    node.addEventListener('keyup', e => e.stopPropagation());
  }
  control.addEventListener('click', () => {
    composer.hidden = !composer.hidden;
    if (composer.hidden) return;
    input.value = '';
    showCount();
    input.focus();
  });
  document.body.append(control, composer);
}

export function startAnnouncements(announcer, hostKey) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  announcer.onAnnouncement = addBanner();
  if (hostKey) addHostControl(announcer, hostKey);
}
