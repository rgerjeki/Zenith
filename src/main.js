import './style.css';
import * as THREE from 'three';
import * as Astronomy from 'astronomy-engine';

import { RADIUS } from './config.js';
import { altAzToVector } from './astro/coords.js';
import { LookControls } from './controls/lookControls.js';
import { loadStarCatalog, buildStarField, pickNamedStars } from './sky/stars.js';
import { computeBodies, buildBodyMarkers } from './sky/bodies.js';
import { ISSLayer } from './sky/issLayer.js';
import { Descent } from './intro/descent.js';
import { FocusView } from './focus/focusView.js';
import { createPicker } from './interaction/picking.js';
import { createTextSprite, placeSkyLabel } from './sky/labels.js';
import {
  createSkyGradient,
  createGround,
  createHorizonGlow,
  createHorizonRing,
  createCardinals,
} from './sky/environment.js';
import {
  getBrowserLocation,
  resolveManualEntry,
} from './astro/geolocation.js';
import { fetchHumansInSpace } from './data/humans.js';

// ---------------------------------------------------------------------------
// Milestone 3, your real sky, for your real location.
// Geolocate the observer (with a manual fallback), then place the real stars,
// the Moon, and the visible planets at their true altitude/azimuth for now.
// Bright stars, the Moon, and planets are labeled; every object carries the
// metadata needed for tap-to-identify + Gemini briefings (milestone 6).
// ---------------------------------------------------------------------------

const canvas = document.getElementById('sky');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);
camera.position.set(0, 0, 0);

// Static environment (never changes with location). Grouped so it can be
// hidden while traveling to an object, leaving just the stars, as in space.
const environmentGroup = new THREE.Group();
environmentGroup.add(
  createSkyGradient(),
  createGround(),
  createHorizonGlow(),
  createHorizonRing()
);
scene.add(environmentGroup);
const cardinals = createCardinals();
scene.add(cardinals);

// The celestial objects (stars, planets, Moon, and their labels) live under one
// group that slowly rotates about the celestial pole, so the sky tracks in real
// time. The horizon, cardinals, and ground stay fixed (the observer's frame).
const sky = new THREE.Group();
scene.add(sky);
const SIDEREAL_RATE = (2 * Math.PI) / 86164.0905; // rad/sec (one turn per sidereal day)
const poleAxis = new THREE.Vector3(0, 1, 0);
let skyEpoch = performance.now(); // when the current sky snapshot was computed

// Sky labels (star names, planet/Moon names) live in their own group so they
// can be hidden together while focused on an object.
const labelGroup = new THREE.Group();
sky.add(labelGroup);

const controls = new LookControls(camera, canvas, { yaw: 0, pitch: 18 });
controls.onFirstDrag(() => document.body.classList.add('has-looked'));
if (import.meta.env.DEV) {
  window.__zenith = { controls, camera, get interactive() { return interactive; }, get focus() { return focusView; }, get iss() { return issLayer; }, get sky() { return sky; }, get descent() { return descent; }, fastForward(hours) { skyEpoch -= hours * 3600 * 1000; } };
}

// Everything that depends on location/time lives under here so it can be
// rebuilt cleanly when the observer changes.
const dynamicGroup = new THREE.Group();
sky.add(dynamicGroup);

// The live ISS lives in its own persistent layer (it polls + moves on its own,
// independent of the location-driven rebuild).
const issLayer = new ISSLayer(scene);

// Cinematic intro (owns its own scene/camera; renders during boot only).
const veil = document.getElementById('veil');
const descent = new Descent(renderer, {
  veil,
  caption: document.getElementById('intro-caption'),
  skipButton: document.getElementById('skip-intro'),
});

// Objects the user can tap.
const interactive = { starField: null, bodyMarkers: [] };

let starCatalog = null;
let currentLocation = null;

// Focus view (tap an object → zoom in + AI briefing).
const focusView = new FocusView(renderer, {
  skyCamera: camera,
  controls,
  getMarkerFor: (meta) => interactive.bodyMarkers.find((m) => m.userData.meta === meta) || null,
  onOpen: () => {
    picker.setEnabled(false);
    labelGroup.visible = false;
    cardinals.visible = false;
    environmentGroup.visible = false; // leave just the stars while traveling
    issLayer.setLabelVisible(false);
  },
  onClose: () => {
    picker.setEnabled(true);
    labelGroup.visible = true;
    cardinals.visible = true;
    environmentGroup.visible = true;
    issLayer.setLabelVisible(true);
  },
});
const picker = createPicker(canvas, camera, {
  getStarField: () => interactive.starField,
  getMarkers: () => [...interactive.bodyMarkers, issLayer.marker],
  onPick: (meta, dir) => focusView.open(meta, currentLocation, dir),
});

function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
  group.clear();
}

function addSkyLabel(text, altDeg, azDeg, { worldHeight = 7, color, weight } = {}) {
  const sprite = createTextSprite(text, { color, weight });
  // Nudge the label just above the object so it doesn't sit on top of it.
  placeSkyLabel(sprite, altDeg + 1.6, azDeg, RADIUS.stars, worldHeight);
  labelGroup.add(sprite);
}

function buildSky(location) {
  disposeGroup(dynamicGroup);
  disposeGroup(labelGroup);
  interactive.bodyMarkers = [];
  currentLocation = location;

  const observer = new Astronomy.Observer(location.lat, location.lon, 0);
  const when = new Date();
  const pr = renderer.getPixelRatio();

  // This snapshot is computed for `when`; reset the diurnal rotation so it
  // starts aligned and tracks forward from here about the celestial pole.
  altAzToVector(location.lat, 0, 1, poleAxis).normalize();
  skyEpoch = performance.now();
  sky.quaternion.identity();

  // Point the live ISS layer at this observer and make sure it's polling.
  issLayer.setObserver(location);
  issLayer.start();

  // Stars.
  const starField = buildStarField(starCatalog, observer, when, pr);
  dynamicGroup.add(starField);
  interactive.starField = starField;

  // Persistent labels for the brightest named stars.
  for (const s of pickNamedStars(starField.userData.meta)) {
    addSkyLabel(s.name, s.alt, s.az, {
      worldHeight: 6.5,
      color: 'rgba(210,220,255,0.82)',
      weight: 400,
    });
  }

  // Moon + planets.
  const bodies = computeBodies(observer, when);
  const { group, markers } = buildBodyMarkers(bodies);
  dynamicGroup.add(group);
  interactive.bodyMarkers = markers;
  for (const b of bodies) {
    addSkyLabel(b.name, b.alt, b.az, {
      worldHeight: b.kind === 'moon' ? 9 : 8,
      color: 'rgba(255,246,224,0.92)',
      weight: 500,
    });
  }

  updateHud(location, when);
}

function updateHud(location, when) {
  const locEl = document.querySelector('.hud-location');
  if (locEl) locEl.textContent = location.label;
  const timeEl = document.querySelector('.hud-time');
  if (timeEl) {
    timeEl.textContent = when.toLocaleString([], {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

// --- Location panel -------------------------------------------------------
const panel = document.getElementById('locate');
const gpsBtn = document.getElementById('locate-gps');
const form = document.getElementById('locate-form');
const input = document.getElementById('locate-input');
const statusEl = document.getElementById('locate-status');

function setStatus(msg, isError = false) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('is-error', isError);
}

function showPanel(show) {
  panel.classList.toggle('is-hidden', !show);
}

// Resolves once the user has given us a usable location.
function askForLocation() {
  return new Promise((resolve) => {
    showPanel(true);
    setStatus('');

    const finish = (location) => {
      showPanel(false);
      resolve(location);
    };

    gpsBtn.onclick = async () => {
      setStatus('Finding you…');
      gpsBtn.disabled = true;
      try {
        finish(await getBrowserLocation());
      } catch (err) {
        setStatus(
          err && err.code === 1
            ? 'Location permission denied. Enter a place instead.'
            : "Couldn't get your location. Enter a place instead.",
          true
        );
      } finally {
        gpsBtn.disabled = false;
      }
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      setStatus('Looking that up…');
      try {
        finish(await resolveManualEntry(value));
      } catch (err) {
        setStatus(err.message || "Couldn't find that place.", true);
      }
    };
  });
}

document.getElementById('change-loc').onclick = async () => {
  const location = await askForLocation();
  // Fly there: stop the sky loop so the descent alone owns the canvas, build the
  // new sky behind the veil, swoop down to it, then reveal and resume.
  stopSkyLoop();
  buildSky(location);
  await descent.play(location);
  fadeVeilOut();
  startSkyLoop();
};

// Fade the bright hand-off veil away to reveal the live sky beneath it.
function fadeVeilOut(duration = 900) {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      veil.style.opacity = String(1 - t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

// --- Boot -----------------------------------------------------------------
async function boot() {
  // Load the catalog while the user is choosing a location.
  const catalogPromise = loadStarCatalog();
  const location = await askForLocation();
  starCatalog = await catalogPromise;

  // Build the sky first so it's ready behind the flash, then swoop down to it.
  buildSky(location);
  await descent.play(location);
  startSkyLoop();
  fadeVeilOut();
  showHumansInSpace();
}

// The quiet emotional beat: there are people up there right now.
async function showHumansInSpace() {
  const data = await fetchHumansInSpace();
  if (!data || !data.number) return;
  const el = document.getElementById('humans');
  el.querySelector('.hud-humans-count').textContent =
    `${data.number} ${data.number === 1 ? 'human' : 'humans'} in space`;
  el.querySelector('.hud-humans-names').textContent = data.people
    .map((p) => p.name)
    .join(' · ');
  el.classList.remove('is-hidden');
  el.addEventListener('click', () => el.classList.toggle('is-open'));
}
boot().catch((err) => console.error('[Zenith] boot failed:', err));

// --- Render loop ----------------------------------------------------------
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  descent.resize();
  focusView.resize();
}
window.addEventListener('resize', onResize);

let skyRaf = null;
function startSkyLoop() {
  if (skyRaf !== null) return;
  const clock = new THREE.Clock();
  const tick = () => {
    const dt = clock.getDelta();
    const now = performance.now();

    controls.update();
    issLayer.update(now);
    // Diurnal rotation: the whole sky turns slowly about the celestial pole.
    sky.quaternion.setFromAxisAngle(poleAxis, -SIDEREAL_RATE * ((now - skyEpoch) / 1000));
    if (interactive.starField) {
      interactive.starField.material.uniforms.uTime.value = now * 0.001;
    }
    renderer.render(scene, camera);

    // Focus close-up is drawn as a second pass over the (dimmed) sky.
    if (focusView.isActive()) {
      renderer.autoClear = false;
      renderer.clearDepth();
      focusView.render();
      renderer.autoClear = true;
    }
    focusView.update(dt, now);

    skyRaf = requestAnimationFrame(tick);
  };
  skyRaf = requestAnimationFrame(tick);
}

// Stop the sky loop so a fly-to descent can own the canvas by itself.
function stopSkyLoop() {
  if (skyRaf !== null) {
    cancelAnimationFrame(skyRaf);
    skyRaf = null;
  }
}
