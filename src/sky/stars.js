import * as THREE from 'three';
import * as Astronomy from 'astronomy-engine';
import { altAzToVector } from '../astro/coords.js';
import { bvToColor } from './starColor.js';
import { RADIUS, MAG_LIMIT, MAG_BRIGHT } from '../config.js';

// stars.json is derived from the HYG database, filtered to naked-eye stars.
// Parallel arrays keep it compact:
//   { count, ra[], dec[], mag[], ci[], name[], desig[], con[] }
// ra/dec in degrees, ci = B-V colour index, name = proper name ("" if none),
// desig = Bayer/Flamsteed designation ("" if none), con = constellation abbr.
export async function loadStarCatalog(url = '/stars.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load star catalog: ${res.status}`);
  return res.json();
}

function magToVisual(mag) {
  const t = THREE.MathUtils.clamp((MAG_LIMIT - mag) / (MAG_LIMIT - MAG_BRIGHT), 0, 1);
  const size = 1.4 + Math.pow(t, 1.7) * 6.6; // px before pixel-ratio scaling
  const bright = 0.4 + Math.pow(t, 1.1) * 0.6; // 0..1
  return { size, bright };
}

const STAR_VERTEX = /* glsl */ `
  attribute float size;
  attribute float bright;
  attribute float phase;
  attribute vec3 starColor;
  varying float vBright;
  varying vec3 vColor;
  varying float vHorizon;
  uniform float uPixelRatio;
  uniform float uTime;
  void main() {
    // Gentle twinkle, each star breathes on its own phase.
    float tw = 0.86 + 0.14 * sin(uTime * 2.0 + phase);
    vBright = bright * tw;
    vColor = starColor;
    // World-space height so the sky can rotate and stars set below the horizon.
    vec4 world = modelMatrix * vec4(position, 1.0);
    vHorizon = world.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = world.y < 0.0 ? 0.0 : size * uPixelRatio;
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  varying float vBright;
  varying vec3 vColor;
  varying float vHorizon;
  void main() {
    if (vHorizon < 0.0) discard; // below the horizon
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float halo = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.22, 0.0, d);
    vec3 col = mix(vColor, vec3(1.0), core * 0.7);
    float a = halo * vBright;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

// Build the visible starfield for an observer + moment. Returns a THREE.Points
// whose userData.meta is a per-point array aligned with the geometry, so a
// raycast hit index maps straight back to a star's identity (milestone 6).
export function buildStarField(catalog, observer, date, pixelRatio = 1) {
  const positions = [];
  const sizes = [];
  const brights = [];
  const phases = [];
  const colors = [];
  const meta = [];
  const v = new THREE.Vector3();
  const col = new THREE.Color();

  for (let i = 0; i < catalog.count; i++) {
    const raDeg = catalog.ra[i];
    const decDeg = catalog.dec[i];
    const mag = catalog.mag[i];

    // Include the whole sphere (even below the horizon) so that as the sky
    // rotates over time, stars rise and set correctly. The shader hides any
    // that are currently below the horizon.
    const hor = Astronomy.Horizon(date, observer, raDeg / 15, decDeg, 'normal');

    altAzToVector(hor.altitude, hor.azimuth, RADIUS.stars, v);
    positions.push(v.x, v.y, v.z);

    const { size, bright } = magToVisual(mag);
    sizes.push(size);
    brights.push(bright);
    phases.push(Math.random() * Math.PI * 2);

    bvToColor(catalog.ci[i], col);
    colors.push(col.r, col.g, col.b);

    meta.push({
      kind: 'star',
      name: catalog.name[i] || '',
      desig: catalog.desig[i] || '',
      con: catalog.con[i] || '',
      mag,
      ci: catalog.ci[i],
      distPc: catalog.dist ? catalog.dist[i] : 0, // parsecs; 0 = unknown
      alt: hor.altitude,
      az: hor.azimuth,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('bright', new THREE.Float32BufferAttribute(brights, 1));
  geometry.setAttribute('phase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute('starColor', new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: pixelRatio }, uTime: { value: 0 } },
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;
  points.userData.meta = meta;
  return points;
}

// Pick the brightest named stars to label persistently, the navigation stars
// that orient you (Vega, Arcturus, Sirius…) without cluttering the sky.
export function pickNamedStars(starMeta, { maxMag = 1.7, limit = 24 } = {}) {
  return starMeta
    .filter((s) => s.name && s.mag <= maxMag && s.alt > 0)
    .sort((a, b) => a.mag - b.mag)
    .slice(0, limit);
}
