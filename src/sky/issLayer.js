import * as THREE from 'three';
import { altAzToVector } from '../astro/coords.js';
import { fetchISS, geoToAltAz } from '../astro/iss.js';
import { createTextSprite, placeSkyLabel } from './labels.js';
import { RADIUS } from '../config.js';

const ISS_RADIUS = RADIUS.stars * 0.96; // just in front of the stars
const POLL_MS = 4000; // polite polling (API allows ~1/sec)
const MAX_EXTRAPOLATE_S = 8; // cap dead-reckoning so a stale poll can't drift far
const TRAIL_SECONDS = 180; // how much of the past track to keep
const TRAIL_SAMPLE_MS = 1000;
const TRAIL_MAX = 220;

function glowTexture() {
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(canvas);
}

// A persistent layer that polls the live ISS position, smoothly extrapolates
// its motion between polls, and draws it (with a fading trail) whenever it is
// above the observer's horizon. Survives location changes via setObserver().
export class ISSLayer {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.renderOrder = 4;
    scene.add(this.group);

    const tex = glowTexture();
    const spriteMat = (color) =>
      new THREE.SpriteMaterial({
        map: tex,
        color: new THREE.Color(color),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
    this.halo = new THREE.Sprite(spriteMat(0x7fe9ff));
    this.core = new THREE.Sprite(spriteMat(0xffffff));
    this.group.add(this.halo, this.core);

    this.label = createTextSprite('ISS', {
      color: 'rgba(180,240,255,0.95)',
      weight: 600,
    });
    this.group.add(this.label);

    // Trail as a vertex-coloured polyline (older = dimmer).
    this.trailPos = new Float32Array(TRAIL_MAX * 3);
    this.trailCol = new Float32Array(TRAIL_MAX * 3);
    this.trailGeom = new THREE.BufferGeometry();
    this.trailGeom.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeom.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    this.trailGeom.setDrawRange(0, 0);
    this.trail = new THREE.Line(
      this.trailGeom,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.trail.frustumCulled = false;
    this.group.add(this.trail);

    this.observer = null;
    this.geo = null; // last polled sample
    this.rate = null; // deg/sec drift estimate
    this.ingestAt = 0;
    this.trailSamples = [];
    this.lastTrailAt = 0;
    this.meta = null;
    this._v = new THREE.Vector3();
    this._timer = null;
    this._poll = this._poll.bind(this);
    this._setVisible(false);
  }

  get marker() {
    return this.core;
  }

  setObserver(obs) {
    this.observer = { lat: obs.lat, lon: obs.lon };
    this.trailSamples = [];
    this.trailGeom.setDrawRange(0, 0);
  }

  setLabelVisible(v) {
    this._labelHidden = !v;
  }

  start() {
    if (this._timer) return;
    this._poll();
    this._timer = setInterval(this._poll, POLL_MS);
    // Re-poll the moment the tab becomes visible again, so a backgrounded tab
    // shows a fresh position instead of a stale extrapolation.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this._poll();
    });
  }

  async _poll() {
    try {
      const s = await fetchISS();
      if (this.geo) {
        const dt = s.tSec - this.geo.tSec;
        if (dt > 0 && dt < 60) {
          let dLon = s.lon - this.geo.lon;
          if (dLon > 180) dLon -= 360;
          if (dLon < -180) dLon += 360;
          this.rate = {
            dLat: (s.lat - this.geo.lat) / dt,
            dLon: dLon / dt,
            dAlt: (s.altKm - this.geo.altKm) / dt,
          };
        }
      }
      this.geo = s;
      this.ingestAt = performance.now();
    } catch {
      /* keep last known position; retry next tick */
    }
  }

  _currentGeo(now) {
    if (!this.geo) return null;
    if (!this.rate) return { ...this.geo };
    // Cap how far we dead-reckon: if a poll is stale (backgrounded tab, throttled
    // timers), lag the last real fix rather than drifting wildly off.
    const elapsed = Math.min((now - this.ingestAt) / 1000, MAX_EXTRAPOLATE_S);
    let lon = this.geo.lon + this.rate.dLon * elapsed;
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    return {
      lat: this.geo.lat + this.rate.dLat * elapsed,
      lon,
      altKm: this.geo.altKm + this.rate.dAlt * elapsed,
      visibility: this.geo.visibility,
      velocityKmh: this.geo.velocityKmh,
    };
  }

  _setVisible(v) {
    this.halo.visible = v;
    this.core.visible = v;
    this.label.visible = v && !this._labelHidden;
  }

  update(now) {
    if (!this.observer || !this.geo) {
      this._setVisible(false);
      return;
    }
    const g = this._currentGeo(now);
    const h = geoToAltAz(this.observer, g);
    this.meta = {
      kind: 'iss',
      name: 'ISS',
      alt: h.alt,
      az: h.az,
      rangeKm: h.rangeKm,
      altitudeKm: g.altKm,
      velocityKmh: g.velocityKmh,
      visibility: g.visibility,
      lat: g.lat,
      lon: g.lon,
    };
    this.core.userData.meta = this.meta;

    if (h.alt <= 0) {
      this._setVisible(false);
      return;
    }
    this._setVisible(true);

    altAzToVector(h.alt, h.az, ISS_RADIUS, this._v);
    this.halo.position.copy(this._v);
    this.core.position.copy(this._v);
    const pulse = 1 + 0.2 * Math.sin(now * 0.005);
    this.halo.scale.setScalar(15 * pulse);
    this.core.scale.setScalar(5);
    placeSkyLabel(this.label, h.alt + 2.2, h.az, ISS_RADIUS, 6.5);

    if (now - this.lastTrailAt > TRAIL_SAMPLE_MS) {
      this.lastTrailAt = now;
      this.trailSamples.push({ pos: this._v.clone(), t: now });
      const cutoff = now - TRAIL_SECONDS * 1000;
      while (this.trailSamples.length && this.trailSamples[0].t < cutoff) {
        this.trailSamples.shift();
      }
      if (this.trailSamples.length > TRAIL_MAX) {
        this.trailSamples.splice(0, this.trailSamples.length - TRAIL_MAX);
      }
      this._rebuildTrail();
    }
  }

  _rebuildTrail() {
    const n = this.trailSamples.length;
    for (let i = 0; i < n; i++) {
      const p = this.trailSamples[i].pos;
      this.trailPos[i * 3] = p.x;
      this.trailPos[i * 3 + 1] = p.y;
      this.trailPos[i * 3 + 2] = p.z;
      const a = n > 1 ? i / (n - 1) : 1; // 0 oldest -> 1 newest
      const c = 0.06 + 0.5 * a;
      this.trailCol[i * 3] = c * 0.5;
      this.trailCol[i * 3 + 1] = c;
      this.trailCol[i * 3 + 2] = c;
    }
    this.trailGeom.attributes.position.needsUpdate = true;
    this.trailGeom.attributes.color.needsUpdate = true;
    this.trailGeom.setDrawRange(0, n);
    this.trailGeom.computeBoundingSphere();
  }
}
