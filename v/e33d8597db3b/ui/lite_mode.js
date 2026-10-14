// Lighter drawing for slow devices: while the frame rate stays low, the game draws
// fewer players, and only those close by (src/pc/web/web_puppets.c). It steps down
// and never back up during a visit, so it doesn't flap.
//   ?lite=0 never, ?lite=1 / ?lite=2 start at that step
//   setView(maxShown, maxDistance): 0 distance = no limit

const STEPS = [
  { maxShown: 31, maxDistance: 0, belowFps: 40 }, // as normal, until frames drop under 40/s
  { maxShown: 16, maxDistance: 5000, belowFps: 25 },
  { maxShown: 8, maxDistance: 2500, belowFps: 0 },
];
const WINDOW_MS = 2000;
const SLOW_WINDOWS = 3;  // in a row: a level loading doesn't count
const WARMUP_MS = 15000; // the game's start is always slow

export function startLiteMode(params, setView) {
  const forced = params.get('lite');
  if (forced === '0') return;
  let step = Math.min(Number(forced) || 0, STEPS.length - 1);
  const apply = () => setView(STEPS[step].maxShown, STEPS[step].maxDistance);
  if (step > 0) apply();

  let frames = 0;
  let windowStart = performance.now() + WARMUP_MS;
  let slow = 0;
  const frame = now => {
    frames++;
    if (document.hidden) { frames = 0; windowStart = now; } // hidden pages get few frames anyway
    if (now - windowStart >= WINDOW_MS) {
      const fps = frames * 1000 / (now - windowStart);
      slow = fps < STEPS[step].belowFps ? slow + 1 : 0;
      if (slow >= SLOW_WINDOWS && step < STEPS.length - 1) {
        step++;
        slow = 0;
        apply();
        console.info(`lite mode step ${step}: ${fps.toFixed(0)} fps`);
      }
      frames = 0;
      windowStart = now;
    }
    if (step < STEPS.length - 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
