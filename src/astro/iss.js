import { DEG2RAD, RAD2DEG } from './coords.js';

// Live ISS position (subsatellite lat/lon + altitude). CORS-open, keyless.
// Poll politely (~1 req/sec max); we use several seconds between calls.
export async function fetchISS(url = 'https://api.wheretheiss.at/v1/satellites/25544') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ISS fetch failed: ${res.status}`);
  const d = await res.json();
  return {
    lat: d.latitude,
    lon: d.longitude,
    altKm: d.altitude,
    velocityKmh: d.velocity,
    visibility: d.visibility,
    footprintKm: d.footprint,
    tSec: d.timestamp, // unix seconds
  };
}

// WGS84 geodetic (lat, lon, height) -> Earth-Centered-Earth-Fixed metres.
const WGS84_A = 6378137.0;
const WGS84_E2 = 6.69437999014e-3;

function geodeticToECEF(latDeg, lonDeg, hMeters) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const sLat = Math.sin(lat), cLat = Math.cos(lat);
  const sLon = Math.sin(lon), cLon = Math.cos(lon);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sLat * sLat);
  return [
    (N + hMeters) * cLat * cLon,
    (N + hMeters) * cLat * sLon,
    (N * (1 - WGS84_E2) + hMeters) * sLat,
  ];
}

// Where does a target (given geographic lat/lon/alt) appear in the observer's
// local sky? Both points are put in the same Earth-fixed frame and the vector
// between them is rotated into the observer's East-North-Up basis.
export function geoToAltAz(obs, target) {
  const o = geodeticToECEF(obs.lat, obs.lon, 0);
  const t = geodeticToECEF(target.lat, target.lon, target.altKm * 1000);
  const dx = t[0] - o[0], dy = t[1] - o[1], dz = t[2] - o[2];

  const lat = obs.lat * DEG2RAD, lon = obs.lon * DEG2RAD;
  const sLat = Math.sin(lat), cLat = Math.cos(lat);
  const sLon = Math.sin(lon), cLon = Math.cos(lon);

  const e = -sLon * dx + cLon * dy;
  const n = -sLat * cLon * dx - sLat * sLon * dy + cLat * dz;
  const u = cLat * cLon * dx + cLat * sLon * dy + sLat * dz;

  const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const az = (Math.atan2(e, n) * RAD2DEG + 360) % 360;
  const alt = Math.asin(u / range) * RAD2DEG;
  return { alt, az, rangeKm: range / 1000 };
}
