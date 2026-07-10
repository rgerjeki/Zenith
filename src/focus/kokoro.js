// In-browser TTS fallback via Kokoro-82M (open weights, Apache-2.0), run locally
// with kokoro-js. Used only when ElevenLabs narration is unavailable, so the sky
// always has a voice, with no API key or usage limit. The model (~86MB, q8) is
// lazily fetched on first use and cached by the browser afterward.

let ttsPromise = null;

const VOICE = 'af_heart'; // a warm, calm voice

async function loadTTS(onProgress) {
  const { KokoroTTS } = await import('kokoro-js');
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: webgpu ? 'fp32' : 'q8',
    device: webgpu ? 'webgpu' : 'wasm',
    progress_callback: onProgress,
  });
}

// Lazily load (and cache) the model. Retries on a future call if it fails.
function getTTS(onProgress) {
  if (!ttsPromise) {
    ttsPromise = loadTTS(onProgress).catch((err) => {
      ttsPromise = null;
      throw err;
    });
  }
  return ttsPromise;
}

// Returns a playable WAV Blob, or null on failure.
export async function kokoroSynthesize(text, onProgress) {
  try {
    const tts = await getTTS(onProgress);
    const audio = await tts.generate(text, { voice: VOICE });
    return audio.toBlob();
  } catch (err) {
    console.warn('[kokoro] synthesis failed:', err?.message || err);
    return null;
  }
}
