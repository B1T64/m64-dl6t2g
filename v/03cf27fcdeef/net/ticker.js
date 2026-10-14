// Repeating timers that keep their pace in hidden tabs.
// Browsers throttle a hidden page's own timers down to once a minute, which would
// stall discovery and heartbeats; a worker's timers aren't throttled that way and
// its messages still wake the page. Without workers (e.g. Node tests) it falls
// back to setInterval, unref'd so it never keeps a process alive.

const WORKER_SOURCE = `
  const timers = new Map();
  onmessage = ({ data: { id, ms } }) => {
    if (ms > 0) timers.set(id, setInterval(() => postMessage(id), ms));
    else { clearInterval(timers.get(id)); timers.delete(id); }
  };
`;

let worker = null;
let nextId = 1;
const callbacks = new Map();

function sharedWorker() {
  if (worker === null && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
    try {
      worker = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' })));
      worker.onmessage = ({ data: id }) => callbacks.get(id)?.();
    } catch {
      worker = false; // blocked (e.g. by a content policy): use plain timers
    }
  }
  return worker || null;
}

// Calls fn every `ms`; returns a function that stops it
export function every(ms, fn) {
  const w = sharedWorker();
  if (!w) {
    const timer = setInterval(fn, ms);
    timer.unref?.();
    return () => clearInterval(timer);
  }
  const id = nextId++;
  callbacks.set(id, fn);
  w.postMessage({ id, ms });
  return () => { callbacks.delete(id); w.postMessage({ id, ms: 0 }); };
}
