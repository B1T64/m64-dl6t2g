// Next to the chat, bottom center: voice chat and the players in my room.
//   🎤  talk: sends my microphone to players near me who listen (asks first)
//   🔊  listen: plays the voices of players near me (asks first)
//   👥  who's in my room, each with a button to block them (net/peer_hub.js)
// Both voice buttons start off, every visit.
import { ask } from './dialog.js';

const STYLE = `
  #social-bar { position: fixed; left: calc(50% + 86px); bottom: 10px; display: flex; gap: 6px; z-index: 6; }
  #social-bar button { width: 40px; height: 28px; border-radius: 14px; border: 1px solid rgba(255,255,255,.45);
    background: rgba(0,0,0,.35); color: #fff; font-size: 14px; cursor: pointer; padding: 0; }
  #social-bar button.on { background: rgba(42,125,60,.85); }
  #players-panel { position: fixed; left: 50%; bottom: 46px; transform: translateX(-50%); z-index: 7; width: min(92vw, 360px);
    max-height: 50vh; overflow-y: auto; padding: 10px; border-radius: 12px; background: rgba(20,20,30,.9);
    border: 1px solid rgba(255,255,255,.25); font: 14px system-ui, sans-serif; color: #fff; }
  #players-panel[hidden] { display: none; }
  #players-panel .row { display: flex; align-items: center; gap: 8px; padding: 5px 2px; }
  #players-panel .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #players-panel .blocked .name { opacity: .5; text-decoration: line-through; }
  #players-panel button { padding: 4px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.4);
    background: rgba(255,255,255,.08); color: #fff; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  #players-panel .empty { opacity: .7; padding: 4px 2px; }
`;

const TALK_QUESTION = '¿Prender tu micrófono? Te van a escuchar los jugadores que estén cerca tuyo en el juego y tengan las voces activadas.';
const LISTEN_QUESTION = '¿Escuchar el micrófono de otros jugadores? Vas a oír a los que estén cerca tuyo en el juego y tengan el micrófono prendido.';

function button(bar, label, title) {
  const element = document.createElement('button');
  element.textContent = label;
  element.title = title;
  bar.appendChild(element);
  return element;
}

// A voice button: asks before turning on, turns off at once
function addVoiceToggle(bar, { label, title, question, yes, isOn, turnOn, turnOff }) {
  const toggle = button(bar, label, title);
  const show = () => toggle.classList.toggle('on', isOn());
  toggle.addEventListener('click', () => {
    if (isOn()) { turnOff(); show(); return; }
    ask(question, yes, () => Promise.resolve(turnOn()).then(show, err => {
      console.warn(`${title} unavailable:`, err);
      ask('El navegador no dejó usar el micrófono. Revisá los permisos del sitio.', 'Entendido', () => {});
    }));
  });
  show();
}

function addPlayersPanel(bar, { roster, hub }) {
  const toggle = button(bar, '👥', 'Jugadores en tu sala');
  const panel = document.createElement('div');
  panel.id = 'players-panel';
  panel.hidden = true;
  document.body.appendChild(panel);

  const render = () => {
    if (panel.hidden) return;
    panel.replaceChildren();
    if (roster.players.size === 0) {
      panel.innerHTML = '<div class="empty">Nadie más en tu sala por ahora</div>';
      return;
    }
    for (const [id, player] of roster.players) {
      const blocked = hub.isBlocked(id);
      const row = document.createElement('div');
      row.className = blocked ? 'row blocked' : 'row';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = `${player.talking ? '🎤 ' : ''}${player.name || 'Jugador'}`;
      const action = document.createElement('button');
      action.textContent = blocked ? 'Desbloquear' : 'Bloquear';
      action.addEventListener('click', () => { if (blocked) hub.unblock(id); else hub.block(id); render(); });
      row.append(name, action);
      panel.appendChild(row);
    }
  };
  toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; render(); });
  roster.onChange(render);
}

export function startSocialBar({ roster, voice, hub }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'social-bar';
  bar.addEventListener('keydown', e => e.stopPropagation());
  document.body.appendChild(bar);

  addVoiceToggle(bar, {
    label: '🎤', title: 'Micrófono', question: TALK_QUESTION, yes: 'Prender micrófono',
    isOn: () => voice.talking, turnOn: () => voice.startTalking(), turnOff: () => voice.stopTalking(),
  });
  addVoiceToggle(bar, {
    label: '🔊', title: 'Escuchar voces', question: LISTEN_QUESTION, yes: 'Escuchar voces',
    isOn: () => voice.listening, turnOn: () => voice.startListening(), turnOff: () => voice.stopListening(),
  });
  addPlayersPanel(bar, { roster, hub });
}
