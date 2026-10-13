// On-screen controls for phones and tablets: a floating analog stick on the left
// half of the screen and N64 buttons on the right. Each change is pushed to the
// game's touch controller (src/pc/web/web_touch.c) through `send`.

const STICK_RANGE = 80;      // N64 stick values reach about ±80

// Keeps a finger's events on the element it pressed, even sliding off it.
// Best effort: some pointers (e.g. synthetic ones) can't be captured.
const capture = (element, pointerId) => {
  try { element.setPointerCapture(pointerId); } catch {}
};
const STICK_RADIUS_PX = 60;  // finger travel for a full tilt

// N64 button masks (include/PR/os_cont.h)
const BUTTONS = [
  { label: 'A', mask: 0x8000, className: 'a' },
  { label: 'B', mask: 0x4000, className: 'b' },
  { label: 'Z', mask: 0x2000, className: 'z' },
  { label: 'START', mask: 0x1000, className: 'start' },
  { label: 'C◀', mask: 0x0002, className: 'cl' },
  { label: 'C▶', mask: 0x0001, className: 'cr' },
  { label: 'C▲', mask: 0x0008, className: 'cu' },
  { label: 'C▼', mask: 0x0004, className: 'cd' },
];

const STYLE = `
  #touch { position: fixed; inset: 0; pointer-events: none; touch-action: none; user-select: none; -webkit-user-select: none; }
  #touch .stick-zone { position: absolute; left: 0; top: 0; width: 50%; height: 100%; pointer-events: auto; }
  #touch .base, #touch .knob { position: absolute; border-radius: 50%; transform: translate(-50%, -50%); display: none; }
  #touch .base { width: ${STICK_RADIUS_PX * 2}px; height: ${STICK_RADIUS_PX * 2}px; background: rgba(255,255,255,.12); border: 2px solid rgba(255,255,255,.35); }
  #touch .knob { width: 56px; height: 56px; background: rgba(255,255,255,.45); }
  #touch button { position: absolute; pointer-events: auto; border-radius: 50%; border: 2px solid rgba(255,255,255,.5);
    background: rgba(0,0,0,.35); color: #fff; font: 600 16px system-ui, sans-serif; touch-action: none; }
  #touch button.down { background: rgba(255,255,255,.4); }
  #touch .a { right: 24px; bottom: 90px; width: 76px; height: 76px; }
  #touch .b { right: 110px; bottom: 40px; width: 64px; height: 64px; }
  #touch .z { right: 120px; bottom: 140px; width: 56px; height: 56px; }
  #touch .start { left: 50%; top: 12px; transform: translateX(-50%); width: 84px; height: 36px; border-radius: 18px; font-size: 12px; }
  #touch .cl { right: 88px; top: 70px; width: 44px; height: 44px; font-size: 12px; }
  #touch .cr { right: 16px; top: 70px; width: 44px; height: 44px; font-size: 12px; }
  #touch .cu { right: 52px; top: 30px; width: 44px; height: 44px; font-size: 12px; }
  #touch .cd { right: 52px; top: 110px; width: 44px; height: 44px; font-size: 12px; }
`;

export function wantsTouchControls(params) {
  if (params.get('touch') === '1') return true;
  if (params.get('touch') === '0') return false;
  return matchMedia('(pointer: coarse)').matches;
}

// send(stickX, stickY, cameraX, cameraY, buttons)
export function startTouchControls(send) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = '<div class="stick-zone"></div><div class="base"></div><div class="knob"></div>';
  document.body.appendChild(root);

  const state = { x: 0, y: 0, buttons: 0 };
  const push = () => send(state.x, state.y, 0, 0, state.buttons);

  attachStick(root, (x, y) => { state.x = x; state.y = y; push(); });
  for (const button of BUTTONS) {
    attachButton(root, button, pressed => {
      state.buttons = pressed ? state.buttons | button.mask : state.buttons & ~button.mask;
      push();
    });
  }
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

function attachButton(root, { label, className }, onChange) {
  const button = document.createElement('button');
  button.className = className;
  button.textContent = label;
  root.appendChild(button);

  const set = pressed => e => {
    e.preventDefault();
    button.classList.toggle('down', pressed);
    onChange(pressed);
  };
  button.addEventListener('pointerdown', e => { set(true)(e); capture(button, e.pointerId); });
  button.addEventListener('pointerup', set(false));
  button.addEventListener('pointercancel', set(false));
  button.addEventListener('contextmenu', e => e.preventDefault());
}
