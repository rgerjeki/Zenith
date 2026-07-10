// Resolving where the observer is standing. Browser geolocation first; if that
// is denied or unavailable, the caller falls back to manual entry (city search
// or raw coordinates). No API key anywhere.

export function getBrowserLocation({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: 'Your location',
          source: 'gps',
        }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout, maximumAge: 5 * 60 * 1000 }
    );
  });
}

// Free, keyless forward geocoding (Open-Meteo). Returns the best match.
export async function geocodeCity(query) {
  const url =
    'https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' +
    encodeURIComponent(query.trim());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  const data = await res.json();
  const hit = data.results && data.results[0];
  if (!hit) throw new Error('No place found by that name');
  return {
    lat: hit.latitude,
    lon: hit.longitude,
    label: [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', '),
    source: 'search',
  };
}

// Accept "40.7, -74.0" style raw coordinates.
export function parseLatLon(text) {
  const m = text.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    lat,
    lon,
    label: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
    source: 'coords',
  };
}

// Try coordinates first, then treat the input as a place name.
export async function resolveManualEntry(text) {
  const coords = parseLatLon(text);
  if (coords) return coords;
  return geocodeCity(text);
}
