// On-screen controls for phones and tablets: a floating analog stick on the left
// half of the screen, N64 buttons on the right, pinching on the right half to zoom
// the camera, and a chat button. Kept small and
// see-through so the game (and its star counter, top right) stays visible.
// Pad changes go to the game's touch controller (src/pc/web/web_touch.c) through
// `sendPad`; chat lines through `sendChat`.

const STICK_RANGE = 80;      // N64 stick values reach about ±80
const STICK_RADIUS_PX = 56;  // finger travel for a full tilt
const CHAT_MAX = 200;
// The game reads the pad once per frame (30/s): a quicker tap would go unseen, so
// every press lasts at least about two frames
const MIN_PRESS_MS = 70;
// Pinching: each step of this much finger travel is one C up (spread) or C down
const PINCH_STEP_PX = 45;
const C_UP = 0x0008;
const C_DOWN = 0x0004;

// Keeps a finger's events on the element it pressed, even sliding off it.
// Best effort: some pointers (e.g. synthetic ones) can't be captured.
const capture = (element, pointerId) => {
  try { element.setPointerCapture(pointerId); } catch {}
};

// N64 button masks (include/PR/os_cont.h)
const BUTTONS = [
  { label: 'A', mask: 0x8000, className: 'a' },
  { label: 'B', mask: 0x4000, className: 'b' },
  { label: 'Z', mask: 0x2000, className: 'z' },
  { label: 'R', mask: 0x0010, className: 'r pill' },
  { label: 'L', mask: 0x0020, className: 'l pill' },
  { label: 'START', mask: 0x1000, className: 'start pill' },
  { label: '◀', mask: 0x0002, className: 'c cl' },
  { label: '▶', mask: 0x0001, className: 'c cr' },
  { label: '▲', mask: 0x0008, className: 'c cu' },
  { label: '▼', mask: 0x0004, className: 'c cd' },
];

// Right-hand cluster, bottom right: A/B/Z under the thumb (above the camera icon),
// the C diamond above them (not at the top, where the HUD is), R above that. L sits under the lives counter,
// START and chat at the bottom middle: the bottom left is where chat lines appear.
const STYLE = `
  #touch { position: fixed; inset: 0; pointer-events: none; touch-action: none; user-select: none; -webkit-user-select: none; }
  #touch .stick-zone { position: absolute; left: 0; top: 0; width: 50%; height: 100%; pointer-events: auto; }
  #touch .camera-zone { position: absolute; right: 0; top: 0; width: 50%; height: 100%; pointer-events: auto; }
  #touch .base, #touch .knob { position: absolute; border-radius: 50%; transform: translate(-50%, -50%); display: none; }
  #touch .base { width: ${STICK_RADIUS_PX * 2}px; height: ${STICK_RADIUS_PX * 2}px; background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.25); }
  #touch .knob { width: 48px; height: 48px; background: rgba(255,255,255,.35); }
  #touch button { position: absolute; pointer-events: auto; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.35);
    background: rgba(0,0,0,.18); color: rgba(255,255,255,.85); font: 600 15px system-ui, sans-serif; touch-action: none; padding: 0; }
  #touch button.down { background: rgba(255,255,255,.35); }
  #touch .pill { border-radius: 14px; height: 28px; font-size: 11px; }
  #touch .a { right: 18px; bottom: 96px; width: 62px; height: 62px; }
  #touch .b { right: 96px; bottom: 50px; width: 52px; height: 52px; }
  #touch .z { right: 104px; bottom: 124px; width: 44px; height: 44px; font-size: 13px; }
  #touch .c { width: 34px; height: 34px; font-size: 11px; }
  #touch .cu { right: 52px; bottom: 250px; }
  #touch .cd { right: 52px; bottom: 182px; }
  #touch .cl { right: 86px; bottom: 216px; }
  #touch .cr { right: 18px; bottom: 216px; }
  #touch .r { right: 18px; bottom: 296px; width: 52px; }
  #touch .l { left: 14px; top: 104px; width: 52px; }
  #touch .start { left: 50%; bottom: 10px; transform: translateX(-50%); width: 64px; }
  #touch .chat-open { left: calc(50% + 40px); bottom: 10px; width: 40px; border-radius: 14px; height: 28px; font-size: 14px; }
  #touch .chat { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); width: min(92vw, 520px);
    display: none; gap: 6px; pointer-events: auto; }
  #touch .chat.open { display: flex; }
  #touch .chat input { flex: 1; min-width: 0; font: 16px system-ui, sans-serif; padding: 8px 10px; border-radius: 10px;
    border: 1px solid rgba(255,255,255,.4); background: rgba(0,0,0,.6); color: #fff; outline: none; }
  #touch .chat .send { position: static; border-radius: 10px; width: auto; height: auto; padding: 0 14px; background: rgba(0,0,0,.6); }
`;

export function wantsTouchControls(params) {
  if (params.get('touch') === '1') return true;
  if (params.get('touch') === '0') return false;
  return matchMedia('(pointer: coarse)').matches;
}

// sendPad(stickX, stickY, cameraX, cameraY, buttons), sendChat(text)
export function startTouchControls(sendPad, sendChat) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = '<div class="stick-zone"></div><div class="camera-zone"></div><div class="base"></div><div class="knob"></div>';
  document.body.appendChild(root);

  const state = { x: 0, y: 0, buttons: 0 };
  const push = () => sendPad(state.x, state.y, 0, 0, state.buttons);

  const setButton = (mask, pressed) => {
    state.buttons = pressed ? state.buttons | mask : state.buttons & ~mask;
    push();
  };
  attachStick(root, (x, y) => { state.x = x; state.y = y; push(); });
  for (const button of BUTTONS) attachButton(root, button, pressed => setButton(button.mask, pressed));
  attachPinchZoom(root.querySelector('.camera-zone'), mask => {
    setButton(mask, true);
    setTimeout(() => setButton(mask, false), MIN_PRESS_MS * 1.5);
  });
  attachChat(root, sendChat);
}

// A floating stick: it appears where the finger lands and follows that one finger
function attachStick(root, onMove) {
  const zone = root.querySelector('.stick-zone');
  const base = root.querySelector('.base');
  const knob = root.querySelector('.knob');
  let finger = null;
  let origin = null;

  const place = (element, x, y) => { element.style.left = `${x}px`; element.style.top = `${y}px`; };
  const show = visible => { base.style.display = knob.style.display = visible ? 'block' : 'none'; };

  zone.addEventListener('pointerdown', e => {
    if (finger !== null) return;
    finger = e.pointerId;
    origin = { x: e.clientX, y: e.clientY };
    place(base, origin.x, origin.y);
    place(knob, origin.x, origin.y);
    show(true);
    capture(zone, e.pointerId);
  });

  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== finger) return;
    let dx = e.clientX - origin.x;
    let dy = e.clientY - origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance > STICK_RADIUS_PX) { dx *= STICK_RADIUS_PX / distance; dy *= STICK_RADIUS_PX / distance; }
    place(knob, origin.x + dx, origin.y + dy);
    // screen y grows downwards, the N64 stick's upwards
    onMove(Math.round((dx / STICK_RADIUS_PX) * STICK_RANGE), Math.round((-dy / STICK_RADIUS_PX) * STICK_RANGE));
  });

  const release = e => {
    if (e.pointerId !== finger) return;
    finger = null;
    show(false);
    onMove(0, 0);
  };
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
}

function makeButton(root, label, className) {
  const button = document.createElement('button');
  button.className = className;
  button.textContent = label;
  button.addEventListener('contextmenu', e => e.preventDefault());
  root.appendChild(button);
  return button;
}

function attachButton(root, { label, className }, onChange) {
  const button = makeButton(root, label, className);
  let pressedAt = 0;
  let releaseLater = null;
  const press = e => {
    e.preventDefault();
    clearTimeout(releaseLater);
    pressedAt = performance.now();
    button.classList.add('down');
    onChange(true);
    capture(button, e.pointerId);
  };
  const release = e => {
    e.preventDefault();
    button.classList.remove('down');
    const wait = pressedAt + MIN_PRESS_MS - performance.now();
    if (wait > 0) releaseLater = setTimeout(() => onChange(false), wait);
    else onChange(false);
  };
  button.addEventListener('pointerdown', press);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
}

// Two fingers on the right half: spreading them zooms in (C up), pinching zooms out (C down)
function attachPinchZoom(zone, pulse) {
  const fingers = new Map(); // pointer id -> { x, y }
  let lastSpan = null;
  const span = () => {
    const [a, b] = [...fingers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  zone.addEventListener('pointerdown', e => {
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    capture(zone, e.pointerId);
    lastSpan = fingers.size === 2 ? span() : null;
  });
  zone.addEventListener('pointermove', e => {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size !== 2 || lastSpan === null) return;
    const change = span() - lastSpan;
    if (Math.abs(change) < PINCH_STEP_PX) return;
    pulse(change > 0 ? C_UP : C_DOWN);
    lastSpan = span();
  });
  const lift = e => {
    fingers.delete(e.pointerId);
    lastSpan = null;
  };
  zone.addEventListener('pointerup', lift);
  zone.addEventListener('pointercancel', lift);
}

// A chat line typed with the phone's keyboard. Keys typed here stay out of the game.
function attachChat(root, sendChat) {
  const form = document.createElement('form');
  form.className = 'chat';
  form.innerHTML = `<input type="text" maxlength="${CHAT_MAX}" enterkeyhint="send" autocomplete="off" placeholder="Chat del nivel">`
    + '<button type="submit" class="send">Enviar</button>';
  root.appendChild(form);
  const input = form.querySelector('input');

  const close = () => { form.classList.remove('open'); input.blur(); };
  // The keyboard may pan what's visible (iOS): keep the box at the top of what's shown
  const follow = () => { form.style.top = `${(globalThis.visualViewport?.offsetTop ?? 0) + 10}px`; };
  globalThis.visualViewport?.addEventListener('resize', follow);
  globalThis.visualViewport?.addEventListener('scroll', follow);
  // a click (not pointerdown) so phones accept focusing the field and show the keyboard
  makeButton(root, '💬', 'chat-open').addEventListener('click', () => {
    form.classList.add('open');
    input.value = '';
    input.focus();
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) sendChat(text);
    close();
  });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) form.classList.remove('open'); }, 150));
  for (const type of ['keydown', 'keyup', 'keypress']) {
    input.addEventListener(type, e => {
      e.stopPropagation();
      if (type === 'keydown' && e.key === 'Escape') close();
    });
  }
}
