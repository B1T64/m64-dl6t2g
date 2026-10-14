// Start menu: before the game starts, the player picks a name. Character and colors
// are edited in the game, with the player in view (pause menu: PLAYER, or L; see
// src/pc/web/web_pause.c), and the game's config keeps them.
// The event's host enters the host code as their name (net/host.js): they play as the
// host's name, and their signing key is kept here so the code never shows again; anyone
// else picking the host's name gets a fan's name instead.
import { HOST_NAME, hostKeyFromCode, isHostKey, looksLikeHostCode } from '../net/host.js';

const STORE_KEY = 'sm64web.player';
const HOST_KEY_STORE = 'sm64web.host';
const NAME_MAX = 20;

const STYLE = `
  #start-menu { position: fixed; inset: 0; z-index: 10; overflow: auto; background: #0b0b10; color: #e8e8ee;
    font: 15px system-ui, sans-serif; display: flex; justify-content: center; align-items: center; padding: 16px; box-sizing: border-box; }
  #start-menu .card { width: min(100%, 420px); display: flex; flex-direction: column; gap: 16px; }
  #start-menu h1 { margin: 0; font-size: 22px; }
  #start-menu label.field { display: flex; flex-direction: column; gap: 6px; color: #9a9aa8; font-size: 13px; }
  #start-menu input.name { font: 16px system-ui, sans-serif; padding: 10px 12px; border-radius: 8px; border: 1px solid #3a3a48;
    background: #16161e; color: #e8e8ee; }
  #start-menu .hint { color: #9a9aa8; font-size: 13px; line-height: 1.4; }
  #start-menu .play { align-self: flex-start; padding: 12px 28px; border-radius: 10px; border: none;
    background: #e4382b; color: #fff; font: 700 17px system-ui, sans-serif; cursor: pointer; }
`;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch { return null; }
}

function save(player) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(player)); } catch {}
}

const storedHostKey = () => { try { return localStorage.getItem(HOST_KEY_STORE); } catch { return null; } };
const storeHostKey = key => {
  try { if (key) localStorage.setItem(HOST_KEY_STORE, key); else localStorage.removeItem(HOST_KEY_STORE); } catch {}
};

// The host's key if this name is the host code, or the host's name on the host's own
// browser; null otherwise
async function hostKeyFor(name) {
  const fromCode = await hostKeyFromCode(name).catch(() => null);
  if (fromCode) return fromCode;
  const stored = storedHostKey();
  return name === HOST_NAME && await isHostKey(stored).catch(() => false) ? stored : null;
}

// The game refuses names with spaces or characters its font lacks (they become
// "Player") and reads backslashes as color codes: spaces turn into underscores, and
// only Latin letters (accents included), digits and common symbols stay
const cleanName = text => text.replace(/\s+/g, '_').replace(/[^!-[]-~À-ÿ]/g, '').slice(0, NAME_MAX);

// What the old start menu picked (a character and 8 colors), not yet handed to the game
const isPalette = palette => Array.isArray(palette) && palette.length === 8
  && palette.every(color => /^#[0-9a-f]{6}$/i.test(color));
const legacyPick = saved => (saved && !saved.handedOver && Number.isInteger(saved.model) && isPalette(saved.palette)
  ? { model: saved.model, palette: saved.palette } : null);

// Shows the menu; resolves once the player presses Play with
//   { name, hostKey, firstVisit, legacy }
// hostKey: hex, or null for everyone but the host; firstVisit: nothing was ever saved
// here (the game opens its player editor); legacy: the old menu's pick to hand over once.
// `defaultName` fills the name field the first time.
export function chooseName(defaultName) {
  const saved = load();
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'start-menu';
  root.innerHTML = `
    <div class="card">
      <h1>¿Cómo te llamás?</h1>
      <label class="field">Nombre (sin espacios)<input type="text" class="name" maxlength="${NAME_MAX}" autocomplete="nickname"></label>
      <div class="hint">Tu personaje y sus colores se eligen dentro del juego: pausa → PLAYER (o L).</div>
      <button class="play">Jugar</button>
    </div>`;
  document.body.appendChild(root);

  const nameInput = root.querySelector('.name');
  nameInput.value = cleanName(saved?.name || defaultName);
  // a host code being typed (maybe on stream) stays hidden, like a password
  nameInput.addEventListener('input', () => {
    const clean = cleanName(nameInput.value);
    if (clean !== nameInput.value) nameInput.value = clean;
    nameInput.type = looksLikeHostCode(clean) ? 'password' : 'text';
  });

  return new Promise(resolve => {
    const play = root.querySelector('.play');
    play.addEventListener('click', async () => {
      play.disabled = true;
      let name = cleanName(nameInput.value).replace(/^_+|_+$/g, '') || cleanName(defaultName);
      const hostKey = await hostKeyFor(name);
      storeHostKey(hostKey);
      if (hostKey) name = HOST_NAME;
      else if (name.toLowerCase() === HOST_NAME.toLowerCase()) name = `Fan_de_${HOST_NAME}`;
      else if (looksLikeHostCode(name)) name = cleanName(defaultName); // a wrong code isn't shown to everyone
      const legacy = legacyPick(saved);
      save({ name, handedOver: true });
      root.remove();
      style.remove();
      resolve({ name, hostKey, firstVisit: saved === null, legacy });
    });
  });
}
