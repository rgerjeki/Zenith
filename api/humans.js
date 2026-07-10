// Vercel serverless function, "humans in space" proxy.
//
// open-notify's astros.json is HTTP-only, which the browser would block as
// mixed content on an HTTPS deploy, so we fetch it server-side. It's also
// occasionally down, treated as optional, always degrading gracefully.

export default async function handler(req, res) {
  try {
    const r = await fetch('http://api.open-notify.org/astros.json', {
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error(`astros ${r.status}`);
    const d = await r.json();
    const people = (d.people || []).map((p) => ({ name: p.name, craft: p.craft }));
    // Cache at the edge for a few minutes, this number changes rarely.
    res.setHeader('cache-control', 's-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({ number: d.number ?? people.length, people });
  } catch (err) {
    console.error('[humans] fetch failed:', err.message);
    return res.status(200).json({ number: null, people: [], unavailable: true });
  }
}
