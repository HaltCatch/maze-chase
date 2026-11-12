import type { FreeCamera } from '../../engine/babylon.ts';
/** Shared gameplay pitch is positive upward; Babylon's right-handed camera uses the same sign. */
export function aimCamera(camera: FreeCamera, yaw: number, pitch: number, roll = 0) {
  camera.rotation.set(pitch, yaw, roll);
}
