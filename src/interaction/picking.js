import * as THREE from 'three';

// Detect a tap (as opposed to a drag-to-look) on the sky and figure out which
// celestial object it hit. Bodies/ISS (sprites) take priority; otherwise we
// pick the brightest star near the tap point.
export function createPicker(canvas, camera, { getStarField, getMarkers, onPick }) {
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 6; // world units at the star shell
  const ndc = new THREE.Vector2();

  let downX = 0, downY = 0, downT = 0;
  let enabled = true;

  canvas.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
    downT = performance.now();
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!enabled) return;
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved > 8 || performance.now() - downT > 500) return; // it was a drag
    pick(e.clientX, e.clientY);
  });

  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    // Bodies + ISS first (only the currently visible ones).
    const markers = getMarkers().filter((m) => m.visible);
    const bodyHits = raycaster.intersectObjects(markers, false);
    if (bodyHits.length) {
      onPick(bodyHits[0].object.userData.meta);
      return;
    }

    // Stars: choose the brightest within the pick threshold.
    const sf = getStarField();
    if (sf) {
      const hits = raycaster.intersectObject(sf, false);
      if (hits.length) {
        let best = null;
        for (const h of hits) {
          const m = sf.userData.meta[h.index];
          if (!best || m.mag < best.mag) best = m;
        }
        if (best) onPick(best);
      }
    }
  }

  return {
    setEnabled(v) {
      enabled = v;
    },
  };
}
