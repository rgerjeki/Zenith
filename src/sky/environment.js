import * as THREE from 'three';
import { altAzToVector } from '../astro/coords.js';
import { RADIUS } from '../config.js';

// A subtle vertical gradient dome: near-black at the zenith, a faint cool navy
// toward the horizon. Gives the sky depth instead of a flat fill.
export function createSkyGradient() {
  const geo = new THREE.SphereGeometry(RADIUS.sky, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color(0x04060d) },
      uHorizon: { value: new THREE.Color(0x0a1226) },
    },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vY;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      void main() {
        float t = smoothstep(0.0, 0.55, clamp(vY, 0.0, 1.0));
        gl_FragColor = vec4(mix(uHorizon, uZenith, t), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -2;
  return mesh;
}

// Opaque lower hemisphere = the ground. Slightly lifted, cooler right at the
// horizon and near-black below, so there's a readable floor when you look down.
export function createGround() {
  const geo = new THREE.SphereGeometry(RADIUS.ground, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uRim: { value: new THREE.Color(0x0a1020) },
      uDeep: { value: new THREE.Color(0x010208) },
    },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = normalize(position).y; // 0 at horizon, -1 straight down
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vY;
      uniform vec3 uRim;
      uniform vec3 uDeep;
      void main() {
        float t = smoothstep(-0.35, 0.0, vY);
        gl_FragColor = vec4(mix(uDeep, uRim, t), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  return mesh;
}

// A faint glow rising from the horizon line (open cylinder banding the rim,
// brightest at the bottom, fading up). Additive so it reads as light, not paint.
export function createHorizonGlow() {
  const r = RADIUS.stars - 6;
  const geo = new THREE.CylinderGeometry(r, r, 70, 64, 1, true);
  geo.translate(0, 27, 0); // sit just above the horizon line
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(0x2a3a6a) } },
    vertexShader: /* glsl */ `
      varying float vT;
      void main() {
        vT = uv.y; // 0 at bottom (horizon), 1 at top
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vT;
      uniform vec3 uColor;
      void main() {
        float a = smoothstep(1.0, 0.0, vT) * 0.5;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 0;
  return mesh;
}

// The horizon reference circle at altitude 0.
export function createHorizonRing() {
  const segments = 128;
  const pts = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const az = (i / segments) * 360;
    altAzToVector(0, az, RADIUS.stars - 4, v);
    pts.push(v.x, v.y, v.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x3a4a72,
    transparent: true,
    opacity: 0.5,
  });
  return new THREE.LineLoop(geo, mat);
}

function makeLabelSprite(text, { color = 'rgba(226,232,255,0.9)', weight = 500, size = 64 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  return sprite;
}

// N / E / S / W markers sitting just above the horizon. North is emphasized.
export function createCardinals() {
  const group = new THREE.Group();
  const dirs = [
    { text: 'N', az: 0, emphasis: true },
    { text: 'E', az: 90 },
    { text: 'S', az: 180 },
    { text: 'W', az: 270 },
  ];
  const v = new THREE.Vector3();
  for (const d of dirs) {
    const sprite = makeLabelSprite(d.text, {
      color: d.emphasis ? 'rgba(255,214,196,0.95)' : 'rgba(214,224,255,0.75)',
      weight: d.emphasis ? 600 : 500,
    });
    altAzToVector(2.5, d.az, RADIUS.cardinals, v);
    sprite.position.copy(v);
    sprite.scale.setScalar(26);
    group.add(sprite);
  }
  group.renderOrder = 2;
  return group;
}
