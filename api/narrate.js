// Vercel serverless function, ElevenLabs text-to-speech proxy.
//
// Reads a celestial briefing and returns spoken audio, so a warm voice can read
// you the sky. The API key stays server-side. Entirely optional: if no key is
// set, or the request fails, it returns 204 and the app simply stays silent.
//
// Env:
//   ELEVENLABS_API_KEY   (required for narration)
//   ELEVENLABS_VOICE_ID  (optional; defaults to a calm narrator voice)
//   ELEVENLABS_MODEL     (optional; defaults to eleven_multilingual_v2)

const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // "Rachel", a calm, warm voice
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const MAX_CHARS = 700; // briefings are ~300; skip anything unexpectedly long

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
  // Not configured, too long, or rate-limited → stay silent (204).
  if (!apiKey || text.length > MAX_CHARS || rateLimited(req)) return res.status(204).end();

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const modelId = process.env.ELEVENLABS_MODEL || DEFAULT_MODEL;

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
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

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[narrate] ElevenLabs error:', r.status, detail.slice(0, 300));
      return res.status(204).end();
    }

    const audio = Buffer.from(await r.arrayBuffer());
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('cache-control', 'no-store');
    return res.status(200).send(audio);
  } catch (err) {
    console.error('[narrate] request failed:', err.message);
    return res.status(204).end();
  }
}
