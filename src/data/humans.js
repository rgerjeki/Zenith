// "Humans in space right now", via our serverless proxy. Optional and always
// graceful: returns null if unavailable (e.g. `npm run dev` with no functions,
// or open-notify being down).
export async function fetchHumansInSpace() {
  try {
    const res = await fetch('/api/humans');
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      if (data && data.number) return data; // { number, people:[{name, craft}] }
    }
  } catch {
    /* ignore, it's a nice-to-have */
  }
  return null;
}
