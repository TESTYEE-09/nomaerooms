// Persisted user settings (localStorage).

const KEY = 'nomaerooms.settings.v2';

const DEFAULTS = {
  name: '',
  quality: 'medium',
  sensitivity: 1.0,   // 0.3 .. 2.5
  volume: 0.8,        // master
  musicVolume: 0.6,
  fov: 75,
  micEnabled: true,
  micVolume: 1.0,
  clarkVolume: 0.8,
};

export const settings = { ...DEFAULTS };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(settings, DEFAULTS, JSON.parse(raw));
  } catch { /* first run / private mode */ }
  return settings;
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}
