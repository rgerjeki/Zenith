import * as THREE from 'three';
import * as Astronomy from 'astronomy-engine';
import { altAzToVector } from '../astro/coords.js';
import { RADIUS } from '../config.js';

// The bodies we place by real computation. Sizes/colours are for on-screen
// legibility, not scale, the point is "that warm dot low in the east is Mars."
const PLANETS = [
  { body: 'Mercury', label: 'Mercury', color: 0xbfb6a8, size: 10 },
  { body: 'Venus', label: 'Venus', color: 0xfff2cf, size: 16 },
  { body: 'Mars', label: 'Mars', color: 0xff7a53, size: 12 },
  { body: 'Jupiter', label: 'Jupiter', color: 0xf6e4c4, size: 15 },
  { body: 'Saturn', label: 'Saturn', color: 0xf3d9a0, size: 13 },
  { body: 'Uranus', label: 'Uranus', color: 0xa9e6ee, size: 9 },
  { body: 'Neptune', label: 'Neptune', color: 0x8ab4ff, size: 9 },
];

const AU_KM = 149597870.7;

// Compute alt/az + distance for the Moon and planets at a given place/time.
// Only bodies above the horizon are returned. Metadata is carried through for
// labels and for the Gemini briefing later.
export function computeBodies(observer, date) {
  const out = [];

  // Sun (only above the horizon in daytime).
  const sunEq = Astronomy.Equator(Astronomy.Body.Sun, date, observer, true, true);
  const sunHor = Astronomy.Horizon(date, observer, sunEq.ra, sunEq.dec, 'normal');
  if (sunHor.altitude > 0) {
    out.push({
      kind: 'sun',
      name: 'Sun',
      alt: sunHor.altitude,
      az: sunHor.azimuth,
      distKm: sunEq.dist * AU_KM,
      color: 0xfff2c0,
      size: 32,
    });
  }

  // Moon (topocentric apparent position + illuminated fraction + phase).
  const moonEq = Astronomy.Equator(Astronomy.Body.Moon, date, observer, true, true);
  const moonHor = Astronomy.Horizon(date, observer, moonEq.ra, moonEq.dec, 'normal');
  if (moonHor.altitude > 0) {
    const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);
    out.push({
      kind: 'moon',
      name: 'Moon',
      alt: moonHor.altitude,
      az: moonHor.azimuth,
      distKm: moonEq.dist * AU_KM,
      illumination: illum.phase_fraction, // 0..1 lit
      phaseAngle: illum.phase_angle,
      moonPhase: Astronomy.MoonPhase(date), // 0=new, 90=first qtr, 180=full, 270=last
      color: 0xf4f0e6,
      size: 26,
    });
  }

  for (const p of PLANETS) {
    const eq = Astronomy.Equator(Astronomy.Body[p.body], date, observer, true, true);
    const hor = Astronomy.Horizon(date, observer, eq.ra, eq.dec, 'normal');
    if (hor.altitude <= 0) continue;
    let mag = null;
    try {
      mag = Astronomy.Illumination(Astronomy.Body[p.body], date).mag;
    } catch {
      /* magnitude is optional */
    }
    out.push({
      kind: 'planet',
      name: p.label,
      alt: hor.altitude,
      az: hor.azimuth,
      distKm: eq.dist * AU_KM,
      distAU: eq.dist,
      mag,
      color: p.color,
      size: p.size,
    });
  }

  return out;
}

// A soft round sprite texture, cached and tinted per body.
let _discTexture = null;
function discTexture() {
  if (_discTexture) return _discTexture;
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.35)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _discTexture = new THREE.CanvasTexture(canvas);
  return _discTexture;
}

// Build sprite markers for the computed bodies. Each sprite carries its data in
// userData.meta for tap-to-identify / briefing. Returns { group, markers }.
export function buildBodyMarkers(bodies) {
  const group = new THREE.Group();
  group.renderOrder = 3;
  const markers = [];
  const v = new THREE.Vector3();

  for (const b of bodies) {
    const mat = new THREE.SpriteMaterial({
      map: discTexture(),
      color: new THREE.Color(b.color),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    altAzToVector(b.alt, b.az, RADIUS.stars, v);
    sprite.position.copy(v);
    sprite.scale.setScalar(b.size);
    sprite.userData.meta = b;
    group.add(sprite);
    markers.push(sprite);
  }

  return { group, markers };
}
