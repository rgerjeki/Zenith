import * as THREE from 'three';
import { altAzToVector } from '../astro/coords.js';

// Text as a camera-facing sprite drawn from a canvas texture. Sprites keep the
// label upright and legible no matter where you turn.
export function createTextSprite(text, {
  color = 'rgba(226,232,255,0.92)',
  weight = 500,
  fontSize = 64,
  pad = 12,
} = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `${weight} ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = fontSize + pad * 2;
  canvas.width = w;
  canvas.height = h;

  // Re-set after resize (resizing the canvas clears the context state).
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 7;
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.userData.aspect = w / h;
  return sprite;
}

// Place a sprite in the sky at (altitude, azimuth), sized to a world height so
// it doesn't get stretched by the source canvas aspect ratio.
export function placeSkyLabel(sprite, altDeg, azDeg, radius, worldHeight) {
  altAzToVector(altDeg, azDeg, radius, sprite.position);
  sprite.scale.set(worldHeight * sprite.userData.aspect, worldHeight, 1);
  return sprite;
}
