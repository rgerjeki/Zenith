import * as THREE from 'three';
import { bvToColor } from '../sky/starColor.js';
import { DEG2RAD } from '../astro/coords.js';

// Detailed close-ups shown in the focus view. Textures are lazy-loaded (only
// fetched the first time you actually zoom into that body), so they never
// weigh down the initial sky.

const loader = new THREE.TextureLoader();
const texCache = new Map();
function texture(url) {
  if (!texCache.has(url)) {
    const t = loader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    texCache.set(url, t);
  }
  return texCache.get(url);
}

const PLANET_FILE = {
  Mercury: 'mercury',
  Venus: 'venus',
  Mars: 'mars',
  Jupiter: 'jupiter',
  Saturn: 'saturn',
  Uranus: 'uranus',
  Neptune: 'neptune',
};
const AXIAL_TILT = { Mercury: 0.03, Venus: 2.6, Mars: 25.2, Jupiter: 3.1, Saturn: 26.7, Uranus: 82, Neptune: 28.3 };

function radialGlow(color, size, opacity = 1) {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  sprite.scale.setScalar(size);
  return sprite;
}

function buildPlanet(meta) {
  const group = new THREE.Group();
  const file = PLANET_FILE[meta.name];
  const mat = new THREE.MeshStandardMaterial({
    map: file ? texture(`/textures/planets/${file}.jpg`) : null,
    color: file ? 0xffffff : new THREE.Color(meta.color || 0xffffff),
    roughness: 1,
    metalness: 0,
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), mat);
  group.add(globe);

  if (meta.name === 'Saturn') {
    group.add(saturnRing());
    group.scale.setScalar(0.62); // fit the rings in frame
  }

  const tiltGroup = new THREE.Group();
  // Tip the pole toward the viewer so rings/bands open up (not edge-on), since
  // the focus orients local +Z toward the camera.
  tiltGroup.rotation.x = -(20 + (AXIAL_TILT[meta.name] || 0) * 0.3) * DEG2RAD;
  tiltGroup.add(group);
  tiltGroup.userData.update = (dt) => {
    globe.rotation.y += dt * 0.12;
  };
  tiltGroup.userData.lightDir = new THREE.Vector3(0.7, 0.35, 0.9).normalize();
  tiltGroup.userData.arrivalScale = meta.name === 'Saturn' ? 2.3 : 3.4;
  return tiltGroup;
}

function saturnRing() {
  const inner = 1.25;
  const outer = 2.3;
  const geo = new THREE.RingGeometry(inner, outer, 128, 1);
  // Remap UVs so the ring texture is sampled along the radius.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const v = new THREE.Vector2();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i));
    const r = v.length();
    uv.setXY(i, (r - inner) / (outer - inner), 0.5);
  }
  const ring = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: texture('/textures/planets/saturn-ring.png'),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.rotation.x = Math.PI / 2; // lay flat in the equatorial plane
  return ring;
}

function buildMoon(meta) {
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 64),
    new THREE.MeshStandardMaterial({
      map: texture('/textures/planets/moon.jpg'),
      roughness: 1,
      metalness: 0,
    })
  );
  const group = new THREE.Group();
  group.add(globe);
  group.userData.update = (dt) => {
    globe.rotation.y += dt * 0.05;
  };
  // Light direction from the real phase angle so the lit fraction matches.
  const pa = (meta.phaseAngle || 0) * DEG2RAD;
  group.userData.lightDir = new THREE.Vector3(Math.sin(pa), 0.12, Math.cos(pa)).normalize();
  group.userData.arrivalScale = 3.4;
  return group;
}

function buildStar(meta) {
  const group = new THREE.Group();
  const color = bvToColor(meta.ci ?? 0.4).clone();
  const bright = color.clone().lerp(new THREE.Color(0xffffff), 0.4);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 48, 32),
    new THREE.MeshBasicMaterial({ color: bright })
  );
  group.add(core);
  group.add(radialGlow(color, 2.4, 0.85));
  group.add(radialGlow(color, 3.6, 0.3));

  group.userData.selfLit = true;
  group.userData.arrivalScale = 1.7;
  group.userData.update = (dt, now) => {
    const p = 1 + 0.03 * Math.sin(now * 0.002);
    core.scale.setScalar(p);
  };
  return group;
}

// A gold solar-array texture with a visible cell grid.
let _solarTex = null;
function solarTexture() {
  if (_solarTex) return _solarTex;
  const w = 256;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#8a6a22');
  g.addColorStop(0.5, '#5d4413');
  g.addColorStop(1, '#7c5c1b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(12,9,3,0.75)';
  ctx.lineWidth = 1;
  const cols = 18;
  const rows = 8;
  for (let i = 0; i <= cols; i++) {
    const x = Math.round((i * w) / cols) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    const y = Math.round((j * h) / rows) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  _solarTex = new THREE.CanvasTexture(c);
  _solarTex.colorSpace = THREE.SRGBColorSpace;
  _solarTex.anisotropy = 8;
  return _solarTex;
}

function buildISS() {
  const iss = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xcfd3da, roughness: 0.5, metalness: 0.65 });
  const white = new THREE.MeshStandardMaterial({ color: 0xeceef2, roughness: 0.7, metalness: 0.1 });
  const array = new THREE.MeshStandardMaterial({
    map: solarTexture(),
    side: THREE.DoubleSide,
    roughness: 0.45,
    metalness: 0.3,
    emissive: 0x3a2c0a,
    emissiveIntensity: 0.3,
  });

  // Integrated truss (the long backbone) along X, with segment detail.
  iss.add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 0.08), metal));
  for (const x of [-0.75, -0.4, -0.05, 0.3, 0.65]) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.15), metal);
    seg.position.x = x;
    iss.add(seg);
  }

  // Four big solar-array wings at the truss ends (the dominant feature).
  const wingGeo = new THREE.PlaneGeometry(0.82, 0.6);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo, array);
      w.rotation.x = -Math.PI / 2; // lie flat
      w.position.set(sx * 1.55, 0, sz * 0.4);
      iss.add(w);
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.03), metal);
      mast.position.set(sx * 1.15, 0, sz * 0.4);
      iss.add(mast);
    }
  }

  // Pressurized modules: a stack running front-to-back at the centre.
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.5, 20), white);
  core.rotation.x = Math.PI / 2;
  iss.add(core);
  for (const z of [-0.52, 0.52]) {
    const mod = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.42, 20), white);
    mod.rotation.x = Math.PI / 2;
    mod.position.z = z;
    iss.add(mod);
  }
  // A short cross module.
  const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.7, 16), white);
  cross.rotation.z = Math.PI / 2;
  iss.add(cross);

  // White radiator panels near the centre.
  for (const sz of [-1, 1]) {
    const rad = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.34),
      new THREE.MeshStandardMaterial({
        color: 0xf4f6fa,
        side: THREE.DoubleSide,
        roughness: 0.5,
        metalness: 0.15,
      })
    );
    rad.rotation.x = -Math.PI / 2;
    rad.position.set(0, 0.14, sz * 0.78);
    iss.add(rad);
  }

  const holder = new THREE.Group();
  holder.rotation.set(0.5, 0.62, 0.14); // pleasing three-quarter view
  holder.add(iss);
  holder.userData.update = (dt) => {
    iss.rotation.y += dt * 0.28;
  };
  holder.userData.lightDir = new THREE.Vector3(0.6, 0.55, 0.8).normalize();
  holder.userData.arrivalScale = 1.75;
  return holder;
}

function buildSun() {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 64, 48),
    new THREE.MeshBasicMaterial({ color: 0xffe08a })
  );
  group.add(core);
  group.add(radialGlow(0xffcf6b, 2.7, 0.9));
  group.add(radialGlow(0xffa23a, 4.4, 0.35));

  group.userData.selfLit = true;
  group.userData.arrivalScale = 1.7;
  group.userData.update = (dt, now) => {
    core.scale.setScalar(1 + 0.02 * Math.sin(now * 0.0025));
  };
  return group;
}

export function buildCloseup(meta) {
  switch (meta.kind) {
    case 'moon':
      return buildMoon(meta);
    case 'planet':
      return buildPlanet(meta);
    case 'iss':
      return buildISS(meta);
    case 'sun':
      return buildSun();
    case 'star':
    default:
      return buildStar(meta);
  }
}
