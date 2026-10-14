// Start menu: before the game starts, the player picks a name, a character and its
// colors (skin, clothes, overalls, hair and mustache). The pick is remembered in this
// browser and handed to the game (src/pc/web/web_player.c) by the page.
// The event's host enters the host code as their name (net/host.js): they play as the
// host's name, and their signing key is kept here so the code never shows again; anyone
// else picking the host's name gets a fan's name instead.
import { HOST_NAME, hostKeyFromCode, isHostKey, looksLikeHostCode } from '../net/host.js';

const STORE_KEY = 'sm64web.player';
const HOST_KEY_STORE = 'sm64web.host';
const NAME_MAX = 20;

// enum PlayerPart (src/game/player_palette.h)
const PART = { PANTS: 0, SHIRT: 1, GLOVES: 2, SHOES: 3, HAIR: 4, SKIN: 5, CAP: 6, EMBLEM: 7 };

// enum CharacterType (src/game/characters.h), with the game's own palettes (palettes/*.ini)
// in PART order: pants, shirt, gloves, shoes, hair, skin, cap, emblem
const CHARACTERS = [
  { model: 0, name: 'Mario',   palette: ['#0000ff', '#ff0000', '#ffffff', '#721c0e', '#730600', '#fec179', '#ff0000', '#ff0000'] },
  { model: 1, name: 'Luigi',   palette: ['#0000ff', '#00ff00', '#ffffff', '#721c0e', '#730600', '#fec179', '#00ff00', '#00ff00'] },
  { model: 2, name: 'Toad',    palette: ['#ffffff', '#4c2cd3', '#ffffff', '#68401b', '#730600', '#fed5a1', '#ff0000', '#ff0000'] },
  { model: 4, name: 'Wario',   palette: ['#7f207a', '#ffbd00', '#ffffff', '#0e721c', '#735300', '#fec179', '#ffbd00', '#0000ff'] },
  { model: 3, name: 'Waluigi', palette: ['#161627', '#6126b0', '#ffffff', '#fe7600', '#735300', '#fec179', '#6126b0', '#ffde00'] },
];

// Outfits any character can wear: clothes (shirt and cap) and overalls
const OUTFITS = [
  { name: 'Clásico', clothes: null, pants: null },
  { name: 'Verde', clothes: '#00b000', pants: '#0000ff' },
  { name: 'Fuego', clothes: '#ffffff', pants: '#e01010' },
  { name: 'Sombra', clothes: '#202020', pants: '#505050' },
  { name: 'Hielo', clothes: '#80d0ff', pants: '#ffffff' },
  { name: 'Dorado', clothes: '#ffcc00', pants: '#8a5a00' },
  { name: 'Rosa', clothes: '#ff70c0', pants: '#6a2a8a' },
];

// The colors a player can change, and the palette parts each one paints
const PICKERS = [
  { label: 'Piel', parts: [PART.SKIN] },
  { label: 'Ropa', parts: [PART.SHIRT, PART.CAP] },
  { label: 'Overol', parts: [PART.PANTS] },
  { label: 'Pelo y bigote', parts: [PART.HAIR] },
];

const STYLE = `
  #start-menu { position: fixed; inset: 0; z-index: 10; overflow: auto; background: #0b0b10; color: #e8e8ee;
    font: 15px system-ui, sans-serif; display: flex; justify-content: center; align-items: flex-start; padding: 16px; box-sizing: border-box; }
  #start-menu .card { width: min(100%, 720px); display: grid; grid-template-columns: 150px 1fr; gap: 16px 20px; align-items: start; }
  #start-menu h1 { grid-column: 1 / -1; margin: 0; font-size: 22px; }
  #start-menu .preview { grid-row: span 4; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  #start-menu .preview svg { width: 140px; height: 170px; }
  #start-menu label.field { display: flex; flex-direction: column; gap: 6px; color: #9a9aa8; font-size: 13px; }
  #start-menu input.name { font: 16px system-ui, sans-serif; padding: 8px 10px; border-radius: 8px; border: 1px solid #3a3a48;
    background: #16161e; color: #e8e8ee; max-width: 280px; }
  #start-menu .row { display: flex; flex-wrap: wrap; gap: 8px; }
  #start-menu .section { display: flex; flex-direction: column; gap: 6px; }
  #start-menu .section > span { color: #9a9aa8; font-size: 13px; }
  #start-menu .choice { padding: 8px 12px; border-radius: 8px; border: 1px solid #3a3a48; background: #16161e; color: #e8e8ee;
    font: 600 14px system-ui, sans-serif; cursor: pointer; display: flex; align-items: center; gap: 8px; }
  #start-menu .choice[aria-pressed=true] { border-color: #e4382b; background: #2a1414; }
  #start-menu .dot { width: 14px; height: 14px; border-radius: 50%; border: 1px solid rgba(255,255,255,.4); }
  #start-menu .picker { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; border: 1px solid #3a3a48; background: #16161e; }
  #start-menu .picker input { width: 34px; height: 26px; border: none; padding: 0; background: none; }
  #start-menu .play { grid-column: 1 / -1; justify-self: start; padding: 12px 28px; border-radius: 10px; border: none;
    background: #e4382b; color: #fff; font: 700 17px system-ui, sans-serif; cursor: pointer; }
  @media (max-width: 560px) { #start-menu .card { grid-template-columns: 1fr; } #start-menu .preview { grid-row: auto; } }
`;

// A plain stand-in figure in the player's colors (not the game's model)
const PREVIEW_SVG = `
  <svg viewBox="0 0 140 170" aria-hidden="true">
    <rect data-part="${PART.SHIRT}" x="35" y="88" width="70" height="44" rx="14"/>
    <rect data-part="${PART.PANTS}" x="44" y="104" width="52" height="40" rx="10"/>
    <rect data-part="${PART.PANTS}" x="50" y="88" width="10" height="22"/><rect data-part="${PART.PANTS}" x="80" y="88" width="10" height="22"/>
    <circle data-part="${PART.GLOVES}" cx="30" cy="118" r="10"/><circle data-part="${PART.GLOVES}" cx="110" cy="118" r="10"/>
    <ellipse data-part="${PART.SHOES}" cx="56" cy="152" rx="16" ry="9"/><ellipse data-part="${PART.SHOES}" cx="84" cy="152" rx="16" ry="9"/>
    <circle data-part="${PART.SKIN}" cx="70" cy="58" r="30"/>
    <path data-part="${PART.HAIR}" d="M52 70 q18 12 36 0 q-6 10 -18 9 q-12 1 -18 -9z"/>
    <path data-part="${PART.CAP}" d="M38 52 q4 -30 32 -30 q28 0 32 30 q-32 -8 -64 0z"/>
    <circle data-part="${PART.EMBLEM}" cx="70" cy="38" r="6" stroke="#fff" stroke-width="2"/>
  </svg>`;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}

function save(pick) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(pick)); } catch {}
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

const isPalette = palette => Array.isArray(palette) && palette.length === 8
  && palette.every(color => /^#[0-9a-f]{6}$/i.test(color));

const characterOf = model => CHARACTERS.find(c => c.model === model) || CHARACTERS[0];

// Shows the menu; resolves with { name, model, palette, hostKey } (palette: 8 '#rrggbb',
// PART order; hostKey: hex, or null for everyone but the host) once the player presses
// Play. `defaultName` fills the name field the first time.
export function chooseCharacter(defaultName) {
  const saved = load();
  const pick = {
    name: cleanName(saved.name || defaultName),
    model: characterOf(saved.model).model,
    palette: isPalette(saved.palette) ? saved.palette : [...characterOf(saved.model).palette],
  };

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'start-menu';
  root.innerHTML = `
    <div class="card">
      <h1>Elige tu personaje</h1>
      <div class="preview">${PREVIEW_SVG}<strong class="preview-name"></strong></div>
      <label class="field">Nombre (sin espacios)<input type="text" class="name" maxlength="${NAME_MAX}" autocomplete="nickname"></label>
      <div class="section"><span>Personaje</span><div class="row characters"></div></div>
      <div class="section"><span>Traje</span><div class="row outfits"></div></div>
      <div class="section"><span>Colores</span><div class="row pickers"></div></div>
      <button class="play">Jugar</button>
    </div>`;
  document.body.appendChild(root);
  const $ = selector => root.querySelector(selector);

  const nameInput = $('.name');
  nameInput.value = pick.name;
  // a host code being typed (maybe on stream) stays hidden, like a password
  nameInput.addEventListener('input', () => {
    const clean = cleanName(nameInput.value);
    if (clean !== nameInput.value) nameInput.value = clean;
    nameInput.type = looksLikeHostCode(clean) ? 'password' : 'text';
    pick.name = clean;
    render();
  });

  const choiceButton = (parent, label, color, onPick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.innerHTML = `<span class="dot"></span>${label}`;
    button.querySelector('.dot').style.background = color;
    button.addEventListener('click', onPick);
    parent.appendChild(button);
    return button;
  };

  const characterButtons = CHARACTERS.map(c => ({
    c, button: choiceButton($('.characters'), c.name, c.palette[PART.CAP], () => { pick.model = c.model; pick.palette = [...c.palette]; render(); }),
  }));

  const outfitButtons = OUTFITS.map(outfit => ({
    outfit,
    button: choiceButton($('.outfits'), outfit.name, outfit.clothes || characterOf(pick.model).palette[PART.SHIRT], () => {
      const base = characterOf(pick.model).palette;
      const clothes = outfit.clothes || base[PART.SHIRT];
      pick.palette[PART.SHIRT] = pick.palette[PART.CAP] = clothes;
      pick.palette[PART.PANTS] = outfit.pants || base[PART.PANTS];
      render();
    }),
  }));

  const pickerInputs = PICKERS.map(({ label, parts }) => {
    const wrap = document.createElement('label');
    wrap.className = 'picker';
    wrap.innerHTML = `<input type="color">${label}`;
    const input = wrap.querySelector('input');
    input.addEventListener('input', () => { parts.forEach(part => { pick.palette[part] = input.value; }); render(); });
    $('.pickers').appendChild(wrap);
    return { input, parts };
  });

  function render() {
    root.querySelectorAll('[data-part]').forEach(shape => { shape.setAttribute('fill', pick.palette[Number(shape.dataset.part)]); });
    $('.preview-name').textContent = looksLikeHostCode(pick.name) ? '•••' : (pick.name || defaultName);
    characterButtons.forEach(({ c, button }) => button.setAttribute('aria-pressed', String(c.model === pick.model)));
    const base = characterOf(pick.model).palette;
    outfitButtons.forEach(({ outfit, button }) => {
      const clothes = outfit.clothes || base[PART.SHIRT];
      const pants = outfit.pants || base[PART.PANTS];
      button.querySelector('.dot').style.background = clothes;
      button.setAttribute('aria-pressed', String(pick.palette[PART.SHIRT] === clothes && pick.palette[PART.PANTS] === pants));
    });
    pickerInputs.forEach(({ input, parts }) => { input.value = pick.palette[parts[0]]; });
  }
  render();

  return new Promise(resolve => {
    const play = $('.play');
    play.addEventListener('click', async () => {
      play.disabled = true;
      let name = cleanName(pick.name).replace(/^_+|_+$/g, '') || cleanName(defaultName);
      const hostKey = await hostKeyFor(name);
      storeHostKey(hostKey);
      if (hostKey) name = HOST_NAME;
      else if (name.toLowerCase() === HOST_NAME.toLowerCase()) name = `Fan_de_${HOST_NAME}`;
      else if (looksLikeHostCode(name)) name = cleanName(defaultName); // a wrong code isn't shown to everyone
      const result = { ...pick, name };
      save(result);
      root.remove();
      style.remove();
      resolve({ ...result, hostKey });
    });
  });
}
