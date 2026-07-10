import * as THREE from 'three';
import { buildCloseup } from './closeups.js';
import { describeObject } from './describe.js';
import { requestBriefing } from './briefing.js';
import {
  narrate,
  stopNarration,
  narrationEnabled,
  setNarrationEnabled,
  onNarrationStatus,
} from './narrate.js';
import { altAzToVector, RAD2DEG } from '../astro/coords.js';

// The focus experience is a journey to the object's REAL place in the sky. The
// detailed close-up is positioned exactly where the object is, and the focus
// camera mirrors the sky camera, so as the sky camera flies toward it through
// the real stars, the object grows IN PLACE (not as a centered overlay). On
// arrival the view eases aside so the card fits; closing flies you back.

// The close-up sits in the object's real DIRECTION, starting far enough away
// that it's a tiny dot (smaller than the sky marker → no pop on tap), and grows
// only because the camera actually travels toward it. Distance is interpolated
// in inverse space so the on-screen size grows STEADILY the whole way (not the
// perspective "creep then sudden zoom" at the end). The horizon/ground are
// hidden during the trip so flying out never warps them.
const R_FOCUS = 430; // start distance (well inside the 500 star dome)
const GAP = 9; // arrival distance (sets the object's on-screen size)
const TRAVEL_MS = 1800;
const RETURN_MS = 820;
const FADE_FRAC = 0.28; // fraction of the trip over which the object fades in

// Camera distance-from-origin so the object (at R_FOCUS) grows linearly in
// apparent size as `e` goes 0→1.
function camOffset(e) {
  const dist = 1 / THREE.MathUtils.lerp(1 / R_FOCUS, 1 / GAP, e);
  return R_FOCUS - dist;
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const nlerp = (a, b, t, out) => out.copy(a).lerp(b, t).normalize();

export class FocusView {
  constructor(renderer, { skyCamera, controls, getMarkerFor, onOpen, onClose } = {}) {
    this.renderer = renderer;
    this.skyCamera = skyCamera;
    this.controls = controls;
    this.getMarkerFor = getMarkerFor || (() => null);
    this.onOpen = onOpen;
    this.onClose = onClose;

    // Own scene; its camera is copied from the sky camera every frame so the
    // object renders exactly where it lives in the real sky.
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 2000);
    this.scene.add(new THREE.AmbientLight(0x9fb4e8, 0.28));

    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.light = new THREE.DirectionalLight(0xffffff, 2.3);
    // Parented to the holder so lighting stays relative to the viewer.
    this.holder.add(this.light, this.light.target);

    this.closeup = null;
    this.state = 'idle'; // idle | travel | open | return
    this._t = 0;
    this._reqId = 0;
    this._pending = null;
    this._ready = false;

    this._dir = new THREE.Vector3(); // toward the object
    this._P = new THREE.Vector3(); // object world position
    this._startDir = new THREE.Vector3();
    this._aimDir = new THREE.Vector3();
    this._aimTarget = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._startYaw = 0;
    this._startPitch = 0;
    this._hiddenMarker = null;
    this._fadeMats = []; // { m, base } for fading the close-up in/out

    this._bindDOM();
  }

  _bindDOM() {
    this.overlay = document.getElementById('focus-overlay');
    this.card = document.getElementById('focus-card');
    this.elKind = this.overlay.querySelector('.focus-kind');
    this.elTitle = this.overlay.querySelector('.focus-title');
    this.elFacts = this.overlay.querySelector('.focus-facts');
    this.elText = this.overlay.querySelector('.focus-briefing-text');
    this.elTag = this.overlay.querySelector('.focus-briefing-tag');

    document.getElementById('focus-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('pointerdown', (e) => {
      if (this.state === 'open' && !this.card.contains(e.target)) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (this.state !== 'idle' && e.key === 'Escape') this.close();
    });

    // Narration on/off toggle.
    this.overlay.classList.toggle('narration-off', !narrationEnabled());
    document.getElementById('narrate-toggle').addEventListener('click', () => {
      const on = !narrationEnabled();
      setNarrationEnabled(on);
      this.overlay.classList.toggle('narration-off', !on);
      if (on && this._pending) narrate(this._pending.text);
    });
    // Show a loading state while the local fallback voice model is preparing.
    onNarrationStatus((s) => {
      document.getElementById('narrate-toggle').classList.toggle('is-loading', s === 'preparing');
    });
  }

  isActive() {
    return this.state !== 'idle';
  }

  resize() {
    if (this.state === 'open') this._computeAimTarget();
  }

  // The look direction on arrival, rotated a little off the object so the card
  // doesn't cover it (object slides left on desktop, up on mobile).
  _computeAimTarget() {
    const landscape = window.innerWidth > window.innerHeight;
    const q = new THREE.Quaternion();
    if (landscape) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.26); // look right → object left
    } else {
      this._tmp.crossVectors(this._dir, new THREE.Vector3(0, 1, 0)).normalize(); // camera right
      q.setFromAxisAngle(this._tmp, -0.36); // look up → object drops to upper area above card
    }
    this._aimTarget.copy(this._dir).applyQuaternion(q);
  }

  _disposeCloseup() {
    if (!this.closeup) return;
    this.holder.remove(this.closeup);
    this.closeup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose()); // shared textures are cached, not disposed
      }
    });
    this.closeup = null;
  }

  open(meta, location, dir) {
    // Resolve the object's current direction (the sky rotates over time). With a
    // live direction, refresh alt/az from it so the card matches what's on screen.
    if (dir) {
      this._dir.copy(dir).normalize();
      const alt = Math.asin(THREE.MathUtils.clamp(this._dir.y, -1, 1)) * RAD2DEG;
      const az = (Math.atan2(this._dir.x, -this._dir.z) * RAD2DEG + 360) % 360;
      meta = { ...meta, alt, az };
    } else {
      altAzToVector(meta.alt, meta.az, 1, this._dir);
    }
    const info = describeObject(meta);
    this._P.copy(this._dir).multiplyScalar(R_FOCUS);

    // Start the journey from where we're currently looking (no snap).
    this.skyCamera.getWorldDirection(this._startDir);
    this._startYaw = this.controls ? this.controls.yaw : 0;
    this._startPitch = this.controls ? this.controls.pitch : 0;
    this._aimDir.copy(this._startDir);
    this._aimTarget.copy(this._dir);

    // Hide the object's own sky marker so it doesn't smear as we approach.
    this._hiddenMarker = this.getMarkerFor(meta);
    if (this._hiddenMarker) this._hiddenMarker.visible = false;

    // Build the close-up at the object's real position, facing the camera.
    this._disposeCloseup();
    this.closeup = buildCloseup(meta);
    this.holder.add(this.closeup);
    this.holder.position.copy(this._P);
    this.holder.scale.setScalar(this.closeup.userData.arrivalScale || 3.2);
    // Orient so local +Z faces the camera and +Y stays world-up (no roll),     // this presents planets/rings/phase the intended way up.
    const zAxis = this._dir.clone().negate(); // object → camera
    const upRef = Math.abs(zAxis.y) > 0.98 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3().crossVectors(upRef, zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
    this.holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));

    // Collect materials so the object can fade in from nothing (no "appear" pop).
    this._fadeMats = [];
    this.closeup.traverse((o) => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        m.transparent = true;
        this._fadeMats.push({ m, base: m.opacity ?? 1 });
      }
    });
    this._setFade(0);

    // Lighting relative to the viewer (parented to the holder).
    const selfLit = this.closeup.userData.selfLit;
    this.light.intensity = selfLit ? 0 : 2.3;
    const ld = this.closeup.userData.lightDir || new THREE.Vector3(0.7, 0.4, 0.9);
    this.light.position.copy(ld).multiplyScalar(10);
    this.light.target.position.set(0, 0, 0);

    // Fill the card (hidden until arrival).
    this.elKind.textContent = info.subtitle;
    this.elTitle.textContent = info.title;
    this.elFacts.innerHTML = info.rows
      .map(([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${v}</dd></div>`)
      .join('');
    this.elText.classList.add('is-loading');
    this.elText.textContent = 'Reading the sky…';
    this.elTag.textContent = '';

    if (this.controls) this.controls.enabled = false;
    if (this.onOpen) this.onOpen();
    this.overlay.classList.remove('is-hidden', 'is-ready');
    requestAnimationFrame(() => this.overlay.classList.add('is-visible'));

    this.state = 'travel';
    this._t = 0;
    this._ready = false;
    this._pending = null;

    const reqId = ++this._reqId;
    requestBriefing({ object: info.payload, location }).then((r) => {
      if (reqId !== this._reqId) return;
      this._pending = r;
      if (this._ready) this._applyBriefing();
    });
  }

  _revealCard() {
    this._ready = true;
    this._computeAimTarget();
    this.overlay.classList.add('is-ready');
    if (this._pending) this._applyBriefing();
  }

  _applyBriefing() {
    const { text, fallback } = this._pending;
    this.elText.classList.remove('is-loading');
    this.elText.textContent = text;
    this.elTag.textContent = fallback ? 'offline note' : '✦ written by Gemini';
    this.elTag.classList.toggle('is-fallback', fallback);
    narrate(text); // ElevenLabs, with a local Kokoro fallback; silent if muted
  }

  close() {
    if (this.state !== 'open' && this.state !== 'travel') return;
    stopNarration();
    this.state = 'return';
    this._t = 0;
    this._reqId++;
    this._ready = false;
    this._aimTarget.copy(this._startDir);
    this.overlay.classList.remove('is-ready', 'is-visible');
  }

  _finishClose() {
    this.state = 'idle';
    this.overlay.classList.add('is-hidden');
    this._disposeCloseup();
    if (this._hiddenMarker) {
      this._hiddenMarker.visible = true;
      this._hiddenMarker = null;
    }
    this.skyCamera.position.set(0, 0, 0);
    if (this.controls) {
      this.controls.setLook(this._startYaw, this._startPitch);
      this.controls.enabled = true;
    }
    if (this.onClose) this.onClose();
  }

  _applyAim() {
    this._tmp.copy(this.skyCamera.position).addScaledVector(this._aimDir, 100);
    this.skyCamera.lookAt(this._tmp);
  }

  _setFade(a) {
    for (const f of this._fadeMats) f.m.opacity = f.base * a;
  }

  update(dt, now) {
    if (this.state === 'idle') return;
    if (this.closeup && this.closeup.userData.update) {
      this.closeup.userData.update(dt, now);
    }

    if (this.state === 'travel') {
      this._t += dt * 1000;
      const p = THREE.MathUtils.clamp(this._t / TRAVEL_MS, 0, 1);
      const e = easeInOut(p);
      this.skyCamera.position.copy(this._dir).multiplyScalar(camOffset(e));
      nlerp(this._startDir, this._dir, e, this._aimDir);
      this._applyAim();
      this._setFade(THREE.MathUtils.clamp(p / FADE_FRAC, 0, 1));
      if (this._t >= TRAVEL_MS) {
        this.state = 'open';
        this._revealCard();
      }
    } else if (this.state === 'open') {
      nlerp(this._aimDir, this._aimTarget, Math.min(1, dt * 4), this._aimDir);
      this._applyAim();
    } else if (this.state === 'return') {
      this._t += dt * 1000;
      const p = THREE.MathUtils.clamp(this._t / RETURN_MS, 0, 1);
      const e = easeInOut(p);
      this.skyCamera.position.copy(this._dir).multiplyScalar(camOffset(1 - e));
      nlerp(this._aimDir, this._startDir, Math.min(1, dt * 5), this._aimDir);
      this._applyAim();
      this._setFade(THREE.MathUtils.clamp((1 - p) / FADE_FRAC, 0, 1));
      if (this._t >= RETURN_MS) this._finishClose();
    }

    // Mirror the sky camera so the object renders where it really is.
    this.camera.position.copy(this.skyCamera.position);
    this.camera.quaternion.copy(this.skyCamera.quaternion);
    this.camera.fov = this.skyCamera.fov;
    this.camera.aspect = this.skyCamera.aspect;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
