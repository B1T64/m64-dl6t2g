// The event's overlay, under the lives counter, clear of the game's HUD: how many
// players the world has (net/census.js) and, for the host only, the button that
// opens the castle (net/castle_gate.js). With ?debug=1 it also shows where this page
// sits in the topology, so a screenshot tells why someone isn't seen.

const REFRESH_MS = 2000;

const STYLE = `
  #event-hud { position: fixed; left: 12px; top: 58px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
    pointer-events: none; font: 600 13px system-ui, sans-serif; color: #fff; z-index: 5; }
  #event-hud .count { padding: 4px 10px; border-radius: 12px; background: rgba(0,0,0,.35); white-space: pre; }
  #event-hud .count.debug { font: 11px ui-monospace, monospace; border-radius: 8px; }
  #event-hud .open-castle { pointer-events: auto; padding: 8px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,.5);
    background: rgba(160,30,20,.85); color: #fff; font: 700 14px system-ui, sans-serif; cursor: pointer; }
  #event-hud .open-castle:disabled { opacity: .6; }
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

function addOpenCastleButton(root, castle, hostKey) {
  const button = document.createElement('button');
  button.className = 'open-castle';
  button.textContent = '🏰 Abrir el castillo';
  root.appendChild(button);
  button.addEventListener('keydown', e => e.stopPropagation()); // Enter or space here stay out of the game
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Abriendo…';
    const opened = await castle.openAsHost(hostKey).catch(err => { console.warn('could not open the castle:', err); return false; });
    if (opened) { button.remove(); return; }
    button.disabled = false;
    button.textContent = '🏰 Abrir el castillo (reintentar)';
  });
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
  if (castle && hostKey && !castle.isOpen) addOpenCastleButton(root, castle, hostKey);
}
