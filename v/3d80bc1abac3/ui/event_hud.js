// The event's overlay: under the lives counter, how many players the world has
// (net/census.js); top center, for the host only, the button that opens or closes the
// castle (net/castle_gate.js). With ?debug=1 it also shows where this page
// sits in the topology, so a screenshot tells why someone isn't seen.
import { ask } from './dialog.js';

const REFRESH_MS = 2000;

const STYLE = `
  #event-hud { position: fixed; left: 12px; top: 58px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
    pointer-events: none; font: 600 13px system-ui, sans-serif; color: #fff; z-index: 5; }
  #event-hud .count { padding: 4px 10px; border-radius: 12px; background: rgba(0,0,0,.35); white-space: pre; }
  #event-hud .count.debug { font: 11px ui-monospace, monospace; border-radius: 8px; }
  #castle-control { position: fixed; top: 8px; left: 50%; transform: translateX(-50%); z-index: 6; padding: 8px 16px;
    border-radius: 10px; border: 1px solid rgba(255,255,255,.5); background: rgba(160,30,20,.85); color: #fff;
    font: 700 14px system-ui, sans-serif; cursor: pointer; }
  #castle-control.close { background: rgba(30,30,40,.85); }
  #castle-control:disabled { opacity: .6; }
  @media (pointer: coarse) { #event-hud { top: 140px; } }
`;

const ROLE_NAMES = { delegate: 'delegado', deputy: 'suplente', member: 'miembro' }; // net/seating.js ROLE

// One line about my room, my links and the seat board
function topologyLine(topology) {
  const { zone } = topology;
  const room = zone ? `${zone.name}:${zone.shard}` : 'sin sala';
  const roommates = zone ? zone.room.peers().length : 0;
  const board = topology.board.ready ? 'tablero ok' : 'sin tablero';
  const backbone = topology.backbone ? ` · tubo ${topology.backbone.connectionCount}` : '';
  return `${room} · ${roommates} en la sala · ${ROLE_NAMES[topology.role] ?? topology.role}${backbone} · ${board} · ${topology.connectionCount} enlaces`;
}

function addCounter(root, census, debug) {
  const counter = document.createElement('div');
  counter.className = 'count';
  counter.classList.toggle('debug', debug);
  root.appendChild(counter);
  const refresh = () => {
    const players = census.total();
    const count = `🌍 ${players} ${players === 1 ? 'jugador' : 'jugadores'}`;
    counter.textContent = debug ? `${count}\n${topologyLine(census.topology)}` : count;
  };
  refresh();
  setInterval(refresh, REFRESH_MS);
}

// The host's castle control, top center: opens the castle, and once open, closes it
// (which sends everyone back out, so it asks first)
function addCastleControl(castle, hostKey) {
  const button = document.createElement('button');
  button.id = 'castle-control';
  document.body.appendChild(button);
  button.addEventListener('keydown', e => e.stopPropagation()); // Enter or space here stay out of the game
  let busy = false;
  const show = () => {
    if (busy) return;
    button.classList.toggle('close', castle.isOpen);
    button.textContent = castle.isOpen ? '🔒 Cerrar el castillo' : '🏰 Abrir el castillo';
  };
  const order = async closing => {
    busy = true;
    button.disabled = true;
    button.textContent = closing ? 'Cerrando…' : 'Abriendo…';
    const request = closing ? castle.closeAsHost(hostKey) : castle.openAsHost(hostKey);
    const done = await request.catch(err => { console.warn('castle order failed:', err); return false; });
    busy = false;
    button.disabled = false;
    show();
    if (!done) button.textContent += ' (reintentar)';
  };
  // closing sends everyone out, so it asks first (in the page: a browser dialog would freeze the music)
  button.addEventListener('click', () => {
    if (!castle.isOpen) { order(false); return; }
    ask('¿Cerrar el castillo? Todos vuelven afuera, a los jardines.', 'Cerrar el castillo', () => order(true));
  });
  show();
  setInterval(show, 1000); // an order from elsewhere (another tab of the host), an opening running out
}

// census, castle: from startPeerTransport (null when there's no shared world);
// hostKey: the host's signing key, null for everyone else
export function startEventHud({ census, castle, hostKey, debug = false }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'event-hud';
  document.body.appendChild(root);

  if (census) addCounter(root, census, debug);
  if (castle && hostKey) addCastleControl(castle, hostKey);
}
