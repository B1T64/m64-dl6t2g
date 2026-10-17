// Voice chat and the players in my room, under the player counter (top left).
// Folded, it's one small pill showing whether my microphone and my ears are on (and
// my voice level while I talk). Unfolded, a card with:
//   Micrófono       sends my voice to players near me who listen (asks first)
//   Escuchar voces  plays the voices of players near me (asks first)
//   who's in my room: who has the mic on, who's talking right now, and Block
// Both switches start off, every visit.
import { ask } from './dialog.js';

const REFRESH_MS = 120; // talking indicators

const ICONS = {
  mic: '<svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 6-6.9z"/></svg>',
  ears: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h2v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h2a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9z"/></svg>',
  people: '<svg viewBox="0 0 24 24"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 13c-3.3 0-7 1.6-7 4v2h14v-2c0-2.4-3.7-4-7-4zm7 0c-.5 0-1 0-1.5.1 1.5.9 2.5 2.2 2.5 3.9v2h5v-2c0-2.3-3.1-4-6-4z"/></svg>',
};

const STYLE = `
  #voice { pointer-events: auto; font: 600 13px system-ui, sans-serif; color: #fff; position: relative; }
  #voice svg { width: 16px; height: 16px; fill: currentColor; flex: none; }
  #voice .pill { display: flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 14px; cursor: pointer;
    background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.18); color: #fff; font: inherit; }
  #voice .pill .icon { color: rgba(255,255,255,.4); display: flex; }
  #voice .pill .icon.on { color: #6ee08a; }
  #voice .pill .people { display: flex; align-items: center; gap: 4px; color: rgba(255,255,255,.75); }
  #voice .meter { width: 4px; height: 14px; border-radius: 2px; background: rgba(255,255,255,.15); position: relative; overflow: hidden; }
  #voice .meter i { position: absolute; left: 0; right: 0; bottom: 0; background: #6ee08a; height: 0; }
  #voice .card { position: absolute; left: 0; top: calc(100% + 6px); width: 260px; max-width: calc(100vw - 24px); padding: 12px;
    border-radius: 14px; background: rgba(18,18,28,.92); border: 1px solid rgba(255,255,255,.18);
    box-shadow: 0 8px 24px rgba(0,0,0,.35); display: flex; flex-direction: column; gap: 10px; }
  #voice .card[hidden] { display: none; }
  #voice .switch-row { display: flex; align-items: center; gap: 10px; cursor: pointer; }
  #voice .switch-row .label { flex: 1; }
  #voice .switch { width: 38px; height: 22px; border-radius: 11px; background: rgba(255,255,255,.2); position: relative; transition: background .2s; flex: none; }
  #voice .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .2s; }
  #voice .switch.on { background: #2f9e4f; }
  #voice .switch.on::after { left: 19px; }
  #voice .hint { font: 12px system-ui, sans-serif; color: rgba(255,255,255,.6); }
  #voice .room { border-top: 1px solid rgba(255,255,255,.12); padding-top: 8px; display: flex; flex-direction: column; gap: 2px;
    max-height: 34vh; overflow-y: auto; }
  #voice .room .title { font: 600 12px system-ui, sans-serif; color: rgba(255,255,255,.6); margin-bottom: 4px; }
  #voice .player { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  #voice .player .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  #voice .player .status { font: 11px system-ui, sans-serif; color: rgba(255,255,255,.55); white-space: nowrap; }
  #voice .player .status.audio { color: #6ee08a; }
  #voice .player .mic { color: rgba(255,255,255,.25); display: flex; }
  #voice .player .mic.on { color: rgba(255,255,255,.7); }
  #voice .player .mic.talking { color: #6ee08a; }
  #voice .player.blocked .name { opacity: .45; text-decoration: line-through; }
  #voice .player button { padding: 3px 9px; border-radius: 8px; border: 1px solid rgba(255,255,255,.3); background: transparent;
    color: rgba(255,255,255,.85); font: 600 11px system-ui, sans-serif; cursor: pointer; }
  #voice .player button.kick { border-color: rgba(255,120,120,.6); color: #ffb0b0; }
  #voice .empty { font: 12px system-ui, sans-serif; color: rgba(255,255,255,.5); }
`;

const TALK_QUESTION = '¿Prender tu micrófono? Te van a escuchar los jugadores que estén cerca tuyo en el juego y tengan las voces activadas.';
const LISTEN_QUESTION = '¿Escuchar el micrófono de otros jugadores? Vas a oír a los que estén cerca tuyo en el juego y tengan el micrófono prendido.';
const TALKING_LEVEL = 0.08;
// net/voice.js statusOf, plus 'deaf' while I don't listen
const STATUS_TEXT = { audio: 'te llega', far: 'lejos', waiting: 'conectando…', off: 'sin mic', deaf: '' };

const element = (tag, className, html = '') => {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = html;
  return node;
};

// A switch row that asks before turning on and turns off at once
function switchRow({ icon, label, question, yes, isOn, turnOn, turnOff, changed }) {
  const row = element('div', 'switch-row', `${ICONS[icon]}<span class="label"></span><span class="switch"></span>`);
  row.querySelector('.label').textContent = label;
  const show = () => row.querySelector('.switch').classList.toggle('on', isOn());
  row.addEventListener('click', () => {
    if (isOn()) { turnOff(); show(); changed(); return; }
    ask(question, yes, () => Promise.resolve(turnOn()).then(() => { show(); changed(); }, err => {
      console.warn(`${label} unavailable:`, err);
      ask('El navegador no dejó usar el micrófono. Revisá los permisos del sitio y volvé a intentar.', 'Entendido', () => {});
    }));
  });
  show();
  return row;
}

// The host's: out of the world for everyone (net/kicks.js), after asking
function kickButton(id, player, hub, hostKey, rerender) {
  const kick = element('button', 'kick', 'Expulsar');
  kick.addEventListener('click', () => ask(`¿Expulsar a ${player.name || 'este jugador'}? Desaparece para todos y no puede volver a entrar.`, 'Expulsar',
    () => hub.kicks.kickAsHost(id, hostKey).then(rerender, err => console.warn('kick failed:', err))));
  return kick;
}

function playerRow(id, player, { voice, hub, hostKey }, rerender) {
  const blocked = hub.isBlocked(id);
  const row = element('div', blocked ? 'player blocked' : 'player', `<span class="mic">${ICONS.mic}</span><span class="name"></span><span class="status"></span><button></button>`);
  if (hostKey && !hub.isBanned(id)) row.appendChild(kickButton(id, player, hub, hostKey, rerender));
  row.dataset.id = id;
  row.querySelector('.mic').classList.toggle('on', player.talking);
  row.querySelector('.name').textContent = player.name || 'Jugador';
  const action = row.querySelector('button');
  action.textContent = blocked ? 'Desbloquear' : 'Bloquear';
  action.addEventListener('click', () => { if (blocked) hub.unblock(id); else hub.block(id); rerender(); });
  return row;
}

export function startSocialBar({ roster, voice, hub, hostKey = null }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = element('div', '', '');
  root.id = 'voice';
  root.addEventListener('keydown', e => e.stopPropagation());
  const pill = element('button', 'pill',
    `<span class="icon mic">${ICONS.mic}</span><span class="meter"><i></i></span><span class="icon ears">${ICONS.ears}</span>`
    + `<span>Voz</span><span class="people">${ICONS.people}<b>0</b></span>`);
  const card = element('div', 'card');
  card.hidden = true;
  root.append(pill, card);
  (document.getElementById('event-hud') ?? document.body).appendChild(root);

  const showPill = () => {
    pill.querySelector('.icon.mic').classList.toggle('on', voice.talking);
    pill.querySelector('.icon.ears').classList.toggle('on', voice.listening);
    pill.querySelector('.meter').style.display = voice.talking ? '' : 'none';
    pill.querySelector(".people b").textContent = roster.players.size;
  };

  const room = element('div', 'room');
  const renderRoom = () => {
    room.replaceChildren(element('div', 'title'));
    room.firstChild.textContent = `En tu sala (${roster.players.size})`;
    if (roster.players.size === 0) room.appendChild(element('div', 'empty', 'Nadie más por ahora'));
    for (const [id, player] of roster.players) room.appendChild(playerRow(id, player, { voice, hub, hostKey }, renderRoom));
    showPill();
  };

  card.append(
    switchRow({ icon: 'mic', label: 'Micrófono', question: TALK_QUESTION, yes: 'Prender micrófono',
      isOn: () => voice.talking, turnOn: () => voice.startTalking(), turnOff: () => voice.stopTalking(), changed: showPill }),
    switchRow({ icon: 'ears', label: 'Escuchar voces', question: LISTEN_QUESTION, yes: 'Escuchar voces',
      isOn: () => voice.listening, turnOn: () => voice.startListening(), turnOff: () => voice.stopListening(), changed: showPill }),
    element('div', 'hint', 'Solo se escuchan los jugadores que están cerca en el juego.'),
    room,
  );

  pill.addEventListener('click', () => { card.hidden = !card.hidden; if (!card.hidden) renderRoom(); });
  roster.onChange(() => { if (card.hidden) showPill(); else renderRoom(); });

  // live: my voice level, and who's talking right now
  setInterval(() => {
    if (voice.talking) pill.querySelector('.meter i').style.height = `${Math.round(voice.myLevel() * 100)}%`;
    if (card.hidden) return;
    for (const row of room.querySelectorAll('.player')) {
      row.querySelector('.mic').classList.toggle('talking', voice.levelOf(row.dataset.id) > TALKING_LEVEL);
      const status = voice.listening ? voice.statusOf(row.dataset.id) : 'deaf';
      const label = row.querySelector('.status');
      label.className = `status ${status}`;
      label.textContent = STATUS_TEXT[status];
    }
  }, REFRESH_MS);
  showPill();
}
