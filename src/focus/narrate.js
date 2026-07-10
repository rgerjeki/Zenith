// Speaks a briefing aloud. ElevenLabs first (premium voice, via /api/narrate);
// if that's unavailable (no key, exhausted free tier, or `npm run dev` with no
// functions), fall back to Kokoro-82M running locally in the browser, so the
// sky always has a voice. The user's on/off choice is remembered.

import { kokoroSynthesize } from './kokoro.js';

const STORAGE_KEY = 'zenith:narration';
let enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
let current = null;
let currentUrl = null;
let reqToken = 0;
let statusHandler = null;

export function narrationEnabled() {
  return enabled;
}

export function setNarrationEnabled(on) {
  enabled = on;
  localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  if (!on) stopNarration();
}

// Notify the UI of narration state: 'preparing' (loading the local model) | 'idle'.
export function onNarrationStatus(fn) {
  statusHandler = fn;
}
function setStatus(s) {
  if (statusHandler) statusHandler(s);
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
  setStatus('idle');
}

// Try the ElevenLabs proxy. Returns an audio Blob, or null if unavailable.
async function elevenLabsAudio(text) {
  try {
    const res = await fetch('/api/narrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('audio')) return await res.blob();
  } catch {
    /* fall through to the local model */
  }
  return null;
}

export async function narrate(text) {
  stopNarration();
  if (!enabled || !text) return;
  const token = ++reqToken;

  let blob = await elevenLabsAudio(text);
  if (token !== reqToken || !enabled) return; // superseded or muted meanwhile

  if (!blob) {
    // Local fallback. First use downloads the model, so signal "preparing".
    setStatus('preparing');
    blob = await kokoroSynthesize(text);
    setStatus('idle');
    if (token !== reqToken || !enabled) return;
  }
  if (!blob) return;

  currentUrl = URL.createObjectURL(blob);
  const audio = new Audio(currentUrl);
  audio.volume = 0.9;
  current = audio;
  audio.addEventListener('ended', stopNarration);
  // Autoplay follows a user tap; if the browser blocks it, fail quietly.
  audio.play().catch(() => {});
}
