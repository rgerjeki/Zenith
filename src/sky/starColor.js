import * as THREE from 'three';

// Approximate a star's real colour from its B-V colour index. Blue-white for
// hot stars, warm orange-red for cool ones, Rigel really is blue, Betelgeuse
// really is red. Interpolated across a handful of calibrated stops.
const STOPS = [
  [-0.35, [0.61, 0.69, 1.0]],
  [0.0, [0.79, 0.84, 1.0]],
  [0.3, [0.97, 0.97, 1.0]],
  [0.58, [1.0, 0.96, 0.92]],
  [0.81, [1.0, 0.9, 0.81]],
  [1.15, [1.0, 0.81, 0.66]],
  [1.4, [1.0, 0.73, 0.53]],
  [2.0, [1.0, 0.62, 0.43]],
];

export function bvToColor(bv, target = new THREE.Color()) {
  const x = THREE.MathUtils.clamp(bv, STOPS[0][0], STOPS[STOPS.length - 1][0]);
  let i = 0;
  while (i < STOPS.length - 1 && x > STOPS[i + 1][0]) i++;
  const [b0, c0] = STOPS[i];
  const [b1, c1] = STOPS[Math.min(i + 1, STOPS.length - 1)];
  const t = b1 === b0 ? 0 : (x - b0) / (b1 - b0);
  return target.setRGB(
    c0[0] + (c1[0] - c0[0]) * t,
    c0[1] + (c1[1] - c0[1]) * t,
    c0[2] + (c1[2] - c0[2]) * t
  );
}
