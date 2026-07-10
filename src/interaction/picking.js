import * as THREE from 'three';

// Detect a tap (as opposed to a drag-to-look) on the sky and figure out which
// celestial object it hit. Bodies/ISS (sprites) take priority; otherwise we
// pick the brightest star near the tap point.
export function createPicker(canvas, camera, { getStarField, getMarkers, onPick }) {
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 6; // world units at the star shell
  const ndc = new THREE.Vector2();
  const dir = new THREE.Vector3();
  const bestDir = new THREE.Vector3();

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

    // Bodies + ISS first (only the currently visible ones). Pass the object's
    // CURRENT world direction so the focus flies to where it actually is now
    // (the sky rotates over time).
    const markers = getMarkers().filter((m) => m.visible);
    const bodyHits = raycaster.intersectObjects(markers, false);
    if (bodyHits.length) {
      const obj = bodyHits[0].object;
      obj.getWorldPosition(dir).normalize();
      onPick(obj.userData.meta, dir.clone());
      return;
    }

    // Stars: choose the brightest within the pick threshold that's currently
    // above the horizon (the sky rotates, so recompute each star's position).
    const sf = getStarField();
    if (sf) {
      const hits = raycaster.intersectObject(sf, false);
      if (hits.length) {
        sf.updateWorldMatrix(true, false);
        const pos = sf.geometry.attributes.position;
        let best = null;
        for (const h of hits) {
          dir.fromBufferAttribute(pos, h.index).applyMatrix4(sf.matrixWorld);
          if (dir.y < 0) continue; // below the horizon (hidden)
          const m = sf.userData.meta[h.index];
          if (!best || m.mag < best.mag) {
            best = m;
            bestDir.copy(dir).normalize();
          }
        }
        if (best) onPick(best, bestDir.clone());
      }
    }
  }

  return {
    setEnabled(v) {
      enabled = v;
    },
  };
}
