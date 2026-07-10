// Vercel serverless function - ElevenLabs text-to-speech proxy.
//
// Reads a celestial briefing and returns spoken audio, so a warm voice can read
// you the sky. The API key stays server-side. Entirely optional: if no key is
// set, or no usable voice is found, it returns 204 and the app stays silent.
//
// Free ElevenLabs accounts cannot use the shared "library" voices via the API
// (they 402). So if no ELEVENLABS_VOICE_ID is set, we auto-discover the voices
// on the account and use the first one that actually synthesizes, caching it.
//
// Env:
//   ELEVENLABS_API_KEY   (required for narration)
//   ELEVENLABS_VOICE_ID  (optional; otherwise auto-discovered from the account)
//   ELEVENLABS_MODEL     (optional; defaults to eleven_multilingual_v2)

const DEFAULT_MODEL = 'eleven_multilingual_v2';
const MAX_CHARS = 700;

// Best-effort per-IP rate limit (per warm instance) to protect the tiny free
// tier from bursts. Real guarantee against charges = free-tier key, no billing.
const RL = new Map();
function rateLimited(req, max = 6, windowMs = 12000) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  const now = Date.now();
  const recent = (RL.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return true;
  recent.push(now);
  RL.set(ip, recent);
  if (RL.size > 5000) RL.clear();
  return false;
}

let cachedVoice = null; // the first voice that worked (per warm instance)

// Current ElevenLabs default "premade" voices (warm/calm first). These work as a
// fallback even when the key is scoped to Text-to-Speech only, so GET /v1/voices
// is forbidden. Any that a free account can't use are skipped (they 402).
const KNOWN_VOICES = [
  'EXAVITQu4vr4xnSDxMaL', // Sarah - soft, warm
  'XB0fDUnXU5powFXDhCwa', // Charlotte - warm
  'pFZP5JQG7iQjIQuC4Bku', // Lily - warm
  'JBFqnCBsd6RMkjVDRZzb', // George - warm, mature
  '9BWtsMINqrJLrRacOk9x', // Aria
  'onwK4e9ZLuTAKqWW03F9', // Daniel
];

async function candidateVoices(apiKey) {
  const list = [];
  if (process.env.ELEVENLABS_VOICE_ID) list.push(process.env.ELEVENLABS_VOICE_ID);
  if (cachedVoice) list.push(cachedVoice);
  // Only hit the voices API when we don't yet have a known-good voice.
  if (!cachedVoice) {
    try {
      const r = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data = await r.json();
        for (const v of data.voices || []) list.push(v.voice_id);
      }
    } catch {
      /* fall back to the known defaults below */
    }
    list.push(...KNOWN_VOICES);
  }
  return [...new Set(list)].slice(0, 8);
}

function synthesize(apiKey, voiceId, modelId, text) {
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15 },
    }),
    signal: AbortSignal.timeout(15000),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }
  const text = body && typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'Missing text' });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  // Not configured, too long, or rate-limited -> stay silent (204).
  if (!apiKey || text.length > MAX_CHARS || rateLimited(req)) return res.status(204).end();

  const modelId = process.env.ELEVENLABS_MODEL || DEFAULT_MODEL;
  const voices = await candidateVoices(apiKey);

  let sawPaywall = false;
  for (const voiceId of voices) {
    let r;
    try {
      r = await synthesize(apiKey, voiceId, modelId, text);
    } catch (err) {
      console.error('[narrate] request failed:', err.message);
      break;
    }
    if (r.ok) {
      cachedVoice = voiceId; // reuse this working voice next time
      const audio = Buffer.from(await r.arrayBuffer());
      res.setHeader('content-type', 'audio/mpeg');
      res.setHeader('cache-control', 'no-store');
      return res.status(200).send(audio);
    }
    // 402 = this voice needs a paid plan; try the next one. Any other error
    // (rate limit, quota, bad key) won't be fixed by another voice, so stop.
    if (r.status === 402) {
      sawPaywall = true;
      continue;
    }
    const detail = await r.text().catch(() => '');
    console.error('[narrate] ElevenLabs error:', r.status, detail.slice(0, 200));
    break;
  }

  if (sawPaywall) {
    console.error('[narrate] no free-usable voice found on this account; set ELEVENLABS_VOICE_ID to a voice you own.');
  }
  return res.status(204).end();
}
