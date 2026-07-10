// Vercel serverless function, Gemini proxy for celestial briefings.
//
// The browser NEVER sees GEMINI_API_KEY. The frontend POSTs an object's
// computed facts; we build a grounded prompt, call Gemini server-side, and
// return a short, vivid blurb. Any upstream failure degrades to a graceful
// fallback so the experience never breaks.
//
// Env:
//   GEMINI_API_KEY  (required for real briefings)
//   GEMINI_MODEL    (optional; defaults to gemini-3.5-flash)

const DEFAULT_MODEL = 'gemini-3.5-flash';
// If the primary model is overloaded (503) or rate-limited, fall back to the
// lite model, which has far more free-tier capacity.
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

// Best-effort per-IP rate limit (per warm instance). Insurance against a single
// visitor burning your quota in a burst, the real "never charged" guarantee is
// using free-tier keys with no billing attached.
const RL = new Map();
function rateLimited(req, max = 6, windowMs = 10000) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  const now = Date.now();
  const recent = (RL.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return true;
  recent.push(now);
  RL.set(ip, recent);
  if (RL.size > 5000) RL.clear();
  return false;
}

function buildPrompt({ object, location }) {
  const factLines = Object.entries(object.facts || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const where = location?.label ? `someone standing in ${location.label}` : 'someone standing outside';

  return `You are the voice of Zenith, an app that shows people the real sky above them right now.
Write a short description of the object below for ${where}, looking up at this very moment.

Guidelines:
- 2 to 4 sentences. Vivid and emotionally resonant, but grounded. Never invent numbers or facts; use only the facts given.
- Do not use em dashes or en dashes. Use commas, colons, or separate sentences instead.
- Present tense, second person ("you're looking at…", "right now, above you…").
- Convey genuine wonder and human connection. Avoid purple prose and clichés like "vast expanse" or "twinkling jewels".
- Don't list the numbers back; weave their meaning into the prose.
- Plain text only: no markdown, no heading, just the paragraph.

Object: ${object.name}
What it is: ${object.subtitle || object.kind}
Facts:
${factLines || '- (none)'}`;
}

function fallbackText(object) {
  const n = object?.name || 'this object';
  return `Right now, ${n} is above you: real light from a real place in the sky, arriving at your eyes this very moment. The briefing service is unavailable, but what you're seeing is genuinely there.`;
}

async function callGemini(prompt, { apiKey, model }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,
        topP: 0.95,
        maxOutputTokens: 220,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Gemini ${res.status}`);
    err.status = res.status;
    err.detail = detail.slice(0, 500);
    throw err;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join('')
    .trim();
  if (!text) {
    const err = new Error('Gemini returned no text');
    err.status = 502;
    throw err;
  }
  return text;
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
  if (!body || !body.object || !body.object.name) {
    return res.status(400).json({ error: 'Missing object data' });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  // No key, or too many requests -> graceful fallback (never an error page).
  if (!apiKey || rateLimited(req)) {
    return res.status(200).json({ text: fallbackText(body.object), fallback: true });
  }

  const prompt = buildPrompt(body);
  const models = [...new Set([process.env.GEMINI_MODEL || DEFAULT_MODEL, FALLBACK_MODEL])];

  for (const model of models) {
    try {
      const text = await callGemini(prompt, { apiKey, model });
      return res.status(200).json({ text, model });
    } catch (err) {
      console.error('[briefing]', model, 'failed:', err.status, err.message, (err.detail || '').slice(0, 200));
      // Overloaded / rate-limited -> try the next model. Anything else (bad key,
      // bad request) won't be fixed by another model, so stop.
      if (![429, 500, 503].includes(err.status)) break;
    }
  }
  return res.status(200).json({ text: fallbackText(body.object), fallback: true });
}
