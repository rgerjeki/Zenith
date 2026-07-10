import * as THREE from 'three';
import { altAzToVector } from '../astro/coords.js';

// First-person free-look. The camera never moves, it just rotates in place,
// looking out along a (view-azimuth, view-altitude) direction. "Grab the sky":
// dragging pulls the sky with the pointer, the way Stellarium / Google Sky feel.
//
// yaw   = view azimuth in degrees (0 = North, 90 = East)
// pitch = view altitude in degrees (0 = horizon, up toward zenith)
export class LookControls {
  constructor(camera, domElement, { yaw = 0, pitch = 18 } = {}) {
    this.camera = camera;
    this.el = domElement;

    this.yaw = yaw;
    this.pitch = pitch;
    this.targetYaw = yaw;
    this.targetPitch = pitch;

    this.sensitivity = 0.12; // degrees per pixel
    this.damping = 0.16; // 0..1 toward target each frame
    this.minPitch = -8;
    this.maxPitch = 88;

    this.enabled = true; // the focus dive takes over the camera when false

    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;
    this._dir = new THREE.Vector3();
    this._onFirstDrag = null;

    this._bind();
  }

  // Snap the view to a heading/altitude (used to hand control back after a dive
  // without a jump).
  setLook(yaw, pitch) {
    this.yaw = this.targetYaw = yaw;
    this.pitch = this.targetPitch = pitch;
  }

  onFirstDrag(cb) {
    this._onFirstDrag = cb;
  }

  _bind() {
    this.el.style.cursor = 'grab';
    this.el.addEventListener('pointerdown', (e) => {
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this.el.setPointerCapture(e.pointerId);
      this.el.style.cursor = 'grabbing';
    });

    this.el.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;

      // Grab-the-sky: content follows the pointer.
      this.targetYaw -= dx * this.sensitivity;
      this.targetPitch += dy * this.sensitivity;
      this.targetPitch = THREE.MathUtils.clamp(this.targetPitch, this.minPitch, this.maxPitch);

      if (this._onFirstDrag) {
        this._onFirstDrag();
        this._onFirstDrag = null;
      }
    });

    const end = (e) => {
      this._dragging = false;
      this.el.style.cursor = 'grab';
      if (e.pointerId != null && this.el.hasPointerCapture?.(e.pointerId)) {
        this.el.releasePointerCapture(e.pointerId);
      }
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  update() {
    if (!this.enabled) return;
    this.yaw += (this.targetYaw - this.yaw) * this.damping;
    this.pitch += (this.targetPitch - this.pitch) * this.damping;
    altAzToVector(this.pitch, this.yaw, 1, this._dir);
    this.camera.lookAt(this._dir);
  }
}
