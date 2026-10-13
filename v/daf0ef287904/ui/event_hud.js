// The event's overlay: how many players the world has (net/census.js). Small and
// under the lives counter, clear of the game's HUD.

const REFRESH_MS = 2000;

const STYLE = `
  #event-hud { position: fixed; left: 12px; top: 58px; pointer-events: none; font: 600 13px system-ui, sans-serif;
    color: #fff; z-index: 5; padding: 4px 10px; border-radius: 12px; background: rgba(0,0,0,.35); }
  @media (pointer: coarse) { #event-hud { top: 140px; } }
`;

// census: from startPeerTransport (null when there's no shared world: nothing to show)
export function startEventHud({ census }) {
  if (!census) return;
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const counter = document.createElement('div');
  counter.id = 'event-hud';
  document.body.appendChild(counter);

  const refresh = () => {
    const players = census.total();
    counter.textContent = `🌍 ${players} ${players === 1 ? 'jugador' : 'jugadores'}`;
  };
  refresh();
  setInterval(refresh, REFRESH_MS);
}
