// Client-side call to the /api/briefing serverless function, with a local
// fallback so the experience is never dead, even in `npm run dev` (no
// functions) or if the API is down.

export async function requestBriefing(payload) {
  try {
    const res = await fetch('/api/briefing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      if (data.text) return { text: data.text, fallback: !!data.fallback };
    }
  } catch {
    /* fall through to local fallback */
  }
  return { text: localBlurb(payload), fallback: true };
}

function localBlurb({ object }) {
  const o = object || {};
  const where = o.facts?.['where it is'] ? `, ${o.facts['where it is']}` : '';
  switch (o.kind) {
    case 'star':
      return `You're looking at ${o.name}${where}. It's real light that set out across the dark long before you were born, only now reaching your eyes. ${o.subtitle}.`;
    case 'planet':
      return `That steady point${where} is ${o.name}, not a star but a world, catching the same sunlight you do and sending it back across the solar system to you tonight.`;
    case 'moon':
      return `The Moon hangs${where} above you, the same face humans have watched for all of history, lit right now by a sun that's below your horizon.`;
    case 'sun':
      return `That's the Sun${where}, your own star and by far the closest one to you. The light warming your face left it about eight minutes ago, after a journey of 150 million kilometers.`;
    case 'iss':
      return `Threading${where} is the International Space Station, and there are people aboard it this very moment, looking down, perhaps, at the same night you're looking up into.`;
    default:
      return `Right now, ${o.name || 'this'} is above you, genuinely there, its light arriving at this very moment.`;
  }
}
