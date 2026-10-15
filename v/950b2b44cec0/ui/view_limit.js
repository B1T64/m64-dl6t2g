// How many other players this page draws at most (src/pc/web/web_puppets.c):
//   high end  31 (the start menu's "gama alta": 32 players with oneself)
//   low end   11 (its "gama baja": 12 with oneself)
//   the event's host: everyone in its level, up to 254, or fewer if it set so (event_hud.js)
// Slow devices may still draw fewer (lite_mode.js).

export const VIEW = { high: 31, low: 11, hostMax: 254 };
export const QUALITY = { HIGH: 'high', LOW: 'low' };

const QUALITY_STORE = 'sm64web.quality';
const HOST_VIEW_STORE = 'sm64web.hostView';

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, String(value)); } catch {} },
};

export function savedQuality() {
  return storage.get(QUALITY_STORE) === QUALITY.LOW ? QUALITY.LOW : QUALITY.HIGH;
}

export function saveQuality(quality) { storage.set(QUALITY_STORE, quality); }

const clampHostView = n => Math.min(VIEW.hostMax, Math.max(1, Math.round(n) || VIEW.hostMax));

export function hostView() { return clampHostView(Number(storage.get(HOST_VIEW_STORE))); }

export function saveHostView(n) {
  const view = clampHostView(n);
  storage.set(HOST_VIEW_STORE, view);
  return view;
}

// The most players this page draws, before any slowdown
export function viewCeiling({ hostKey, quality }) {
  if (hostKey) return hostView();
  return quality === QUALITY.LOW ? VIEW.low : VIEW.high;
}
