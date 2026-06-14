// Local save/continue. A run is persisted to localStorage at stable beats
// (back in orbit, after a sale, after a purchase) and can be resumed from the
// menu. Saves are host-only: in co-op the host owns shared state, and guests
// always receive it over the wire. Only economy + ship cargo + the local
// flashlight survive — the world itself is deterministic from the seed.

const KEY = 'nomaelethal.save.v1';

export function saveRun(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, ts: Date.now() }));
  } catch { /* storage full / disabled — ignore */ }
}

export function loadRun() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d.seed !== 'number') return null;
    return d;
  } catch { return null; }
}

export function clearRun() {
  try { localStorage.removeItem(KEY); } catch { /* */ }
}

export function hasSave() {
  return !!loadRun();
}

/** Short human label for the continue button, e.g. "day 4 · $320 · quota $250". */
export function saveLabel() {
  const d = loadRun();
  if (!d) return '';
  return `day ${d.day} · $${d.money} · cycle ${d.cyc}`;
}
