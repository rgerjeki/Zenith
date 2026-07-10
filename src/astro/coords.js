import * as THREE from 'three';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

// Horizontal coordinates -> Three.js world position.
//
// Convention (right-handed, +Y up):
//   azimuth 0°   = North = -Z
//   azimuth 90°  = East  = +X
//   azimuth 180° = South = +Z
//   azimuth 270° = West  = -X
//   altitude 0°  = horizon (Y = 0), altitude 90° = zenith (+Y)
//
// This matches astronomy-engine's Horizon() output (azimuth measured from north,
// increasing eastward) so a body's {altitude, azimuth} places directly.
export function altAzToVector(altDeg, azDeg, radius = 1, target = new THREE.Vector3()) {
  const alt = altDeg * DEG2RAD;
  const az = azDeg * DEG2RAD;
  const cosAlt = Math.cos(alt);
  return target.set(
    radius * cosAlt * Math.sin(az),
    radius * Math.sin(alt),
    -radius * cosAlt * Math.cos(az)
  );
}
