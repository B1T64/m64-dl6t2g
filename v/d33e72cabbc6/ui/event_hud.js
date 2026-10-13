// The event's overlay: how many players the world has (net/census.js) and, for the
// host only, the button that opens the castle (net/castle_gate.js). Small and under
// the lives counter, clear of the game's HUD.

const REFRESH_MS = 2000;

const STYLE = `
  #event-hud { position: fixed; left: 12px; top: 58px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
    pointer-events: none; font: 600 13px system-ui, sans-serif; color: #fff; z-index: 5; }
  #event-hud .count { padding: 4px 10px; border-radius: 12px; background: rgba(0,0,0,.35); }
  #event-hud .open-castle { pointer-events: auto; padding: 8px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,.5);
    background: rgba(160,30,20,.85); color: #fff; font: 700 14px system-ui, sans-serif; cursor: pointer; }
  #event-hud .open-castle:disabled { opacity: .6; }
  @media (pointer: coarse) { #event-hud { top: 140px; } }
`;

// census, castle: from startPeerTransport (null when there's no shared world);
// hostKey: the host's signing key, null for everyone else
export function startEventHud({ census, castle, hostKey }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'event-hud';
  document.body.appendChild(root);

  if (census) {
    const count = document.createElement('div');
    count.className = 'count';
    root.appendChild(count);
    const refresh = () => {
      const players = census.total();
      count.textContent = `🌍 ${players} ${players === 1 ? 'jugador' : 'jugadores'}`;
    };
    refresh();
    setInterval(refresh, REFRESH_MS);
  }

  if (castle && hostKey && !castle.isOpen) {
    const button = document.createElement('button');
    button.className = 'open-castle';
    button.textContent = '🏰 Abrir el castillo';
    root.appendChild(button);
    // keys typed here (Enter, space) stay out of the game
    button.addEventListener('keydown', e => e.stopPropagation());
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Abriendo…';
      const opened = await castle.openAsHost(hostKey).catch(() => false);
      if (opened) { button.remove(); return; }
      button.disabled = false;
      button.textContent = '🏰 Abrir el castillo (reintentar)';
    });
  }
}
