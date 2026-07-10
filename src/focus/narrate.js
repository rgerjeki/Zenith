// Speaks a briefing aloud via the /api/narrate (ElevenLabs) proxy. Optional and
// graceful: silent in `npm run dev` (no functions), if no key is configured, or
// if playback is blocked. The user's on/off choice is remembered.

const STORAGE_KEY = 'zenith:narration';
let enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
let available = null; // null = unknown, true/false once the server has answered
let current = null;
let currentUrl = null;

export function narrationEnabled() {
  return enabled;
}

// null until the first request tells us whether the server has a voice key.
export function narrationAvailable() {
  return available;
}

export function setNarrationEnabled(on) {
  enabled = on;
  localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  if (!on) stopNarration();
}

export function stopNarration() {
  if (current) {
    current.pause();
    current.src = '';
    current = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

export async function narrate(text) {
  stopNarration();
  if (!enabled || !text) return;
  try {
    const res = await fetch('/api/narrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    // 204 (not configured / rate-limited) or non-audio → stay silent.
    const ct = res.headers.get('content-type') || '';
    if (res.status === 204) available = false;
    if (!res.ok || !ct.includes('audio')) return;
    available = true;

    const blob = await res.blob();
    // The user may have closed/switched away while it was generating.
    if (!enabled) return;

    currentUrl = URL.createObjectURL(blob);
    const audio = new Audio(currentUrl);
    audio.volume = 0.9;
    current = audio;
    audio.addEventListener('ended', stopNarration);
    // Autoplay follows a user tap, but if the browser blocks it, fail quietly.
    audio.play().catch(() => {});
  } catch {
    /* narration is a nice-to-have */
  }
}
