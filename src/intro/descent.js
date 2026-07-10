import * as THREE from 'three';
import { DEG2RAD } from '../astro/coords.js';

// Cinematic intro: Earth-in-space, then a swoop down toward the observer's
// location, ending in a bright atmospheric flash that hands off to the sky
// view. Owns its own scene + camera + render loop; skippable at any time.

// Unit vector for a geographic lat/lon on a sphere textured with a standard
// equirectangular map (lon -180..180 left→right, lat +90..-90 top→bottom),
// matching THREE.SphereGeometry's default UV layout.
function latLonToUnit(latDeg, lonDeg, target = new THREE.Vector3()) {
  const phi = (lonDeg + 180) * DEG2RAD;
  const cl = Math.cos(latDeg * DEG2RAD);
  return target.set(-Math.cos(phi) * cl, Math.sin(latDeg * DEG2RAD), Math.sin(phi) * cl);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function glowSprite(color, size) {
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      color: new THREE.Color(color),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
  );
  sprite.scale.setScalar(size);
  return sprite;
}

const DURATION = 4900; // ms of descent before the handoff flash
const CAM_START = new THREE.Vector3(0.95, 0.55, 3.0);
const CAM_END = new THREE.Vector3(0.04, 0.0, 1.14);

export class Descent {
  constructor(renderer, { veil, caption, skipButton }) {
    this.renderer = renderer;
    this.veil = veil;
    this.caption = caption;
    this.skipButton = skipButton;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.01,
      200
    );

    // Backdrop starfield.
    const starPos = [];
    for (let i = 0; i < 1800; i++) {
      const v = new THREE.Vector3()
        .randomDirection()
        .multiplyScalar(60 + Math.random() * 20);
      starPos.push(v.x, v.y, v.z);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.scene.add(
      new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({ color: 0x9fb4e8, size: 0.35, sizeAttenuation: true })
      )
    );

    // Earth.
    this.earth = new THREE.Group();
    this.scene.add(this.earth);

    const tex = new THREE.TextureLoader().load('/textures/earth-day.jpg');
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.globe = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 })
    );
    this.earth.add(this.globe);

    // Atmosphere rim.
    this.earth.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(1.14, 64, 48),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexShader: /* glsl */ `
            varying vec3 vNormal;
            void main() {
              vNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: /* glsl */ `
            varying vec3 vNormal;
            void main() {
              float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
              gl_FragColor = vec4(0.35, 0.6, 1.0, 1.0) * clamp(intensity, 0.0, 1.0);
            }
          `,
        })
      )
    );

    // Location pin (added to the earth group so it rotates with it).
    this.pin = glowSprite(0x9ff0ff, 0.08);
    this.earth.add(this.pin);

    // Lights.
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0x2a3a5c, 0.55));

    this._raf = null;
    this._t0 = 0;
    this._locUnit = new THREE.Vector3();
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  _setVeil(color, opacity) {
    this.veil.style.background = color;
    this.veil.style.opacity = String(opacity);
  }

  _orient(location) {
    latLonToUnit(location.lat, location.lon, this._locUnit);
    // Rotate the globe so the location faces the camera (+Z).
    this.earth.quaternion.setFromUnitVectors(
      this._locUnit.clone(),
      new THREE.Vector3(0, 0, 1)
    );
    // Pin sits on the surface at the location (local coords, pre-rotation).
    this.pin.position.copy(this._locUnit).multiplyScalar(1.015);
    // Light the day side we're diving toward, with a gentle terminator.
    this.sun.position.set(0.5, 0.5, 2).normalize();
  }

  play(location) {
    this._orient(location);
    if (this.caption) this.caption.textContent = location.label;
    this._setVeil('#02040a', 1);

    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(this._raf);
        this.skipButton.classList.add('is-hidden');
        this.skipButton.onclick = null;
        window.removeEventListener('keydown', onKey);
        resolve();
      };

      // Skip = fast-forward the clock straight to the flash by moving the
      // start time earlier (never later, so skipping late can't rewind it).
      const skip = () => {
        const flashStart = performance.now() - (DURATION - 550);
        if (flashStart < this._t0) this._t0 = flashStart;
      };
      this.skipButton.classList.remove('is-hidden');
      this.skipButton.onclick = skip;
      const onKey = (e) => {
        if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') skip();
      };
      window.addEventListener('keydown', onKey);

      this._t0 = performance.now();
      const frame = (now) => {
        const t = now - this._t0;

        // Reveal from black, then dive, then flash to bright.
        const reveal = smoothstep(0, 700, t);
        const p = easeInOutCubic(THREE.MathUtils.clamp((t - 300) / (DURATION - 300), 0, 1));
        this.camera.position.lerpVectors(CAM_START, CAM_END, p);
        this.camera.lookAt(0, 0, 0);

        const flash = smoothstep(DURATION - 700, DURATION, t);
        if (flash > 0) {
          this._setVeil('#dfeaff', flash);
        } else {
          this._setVeil('#02040a', 1 - reveal);
        }

        if (this.caption) {
          const cIn = smoothstep(1600, 2600, t);
          const cOut = 1 - smoothstep(DURATION - 900, DURATION - 300, t);
          this.caption.style.opacity = String(cIn * cOut);
        }

        const pulse = 1 + 0.25 * Math.sin(now * 0.006);
        this.pin.scale.setScalar(0.08 * pulse);

        this.renderer.render(this.scene, this.camera);

        if (t >= DURATION) {
          done();
        } else {
          this._raf = requestAnimationFrame(frame);
        }
      };
      this._raf = requestAnimationFrame(frame);
    });
  }
}
