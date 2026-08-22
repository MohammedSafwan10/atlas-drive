import * as THREE from 'three';

// Shared endless highway centerline. Long wavelengths avoid arcade-like zigzags;
// combining two waves prevents the route from looking mechanically periodic.
export function roadCenterX(z) {
  return Math.sin(z * 0.0085 + 0.7) * 16 + Math.sin(z * 0.003 - 1.1) * 6;
}

export function roadElevation(z) {
  return 0.75 + Math.sin(z * 0.0027 - 0.4) * 1.55 + Math.sin(z * 0.0063 + 1.2) * 0.48;
}

export function roadYaw(z) {
  const step = 1;
  const dx = (roadCenterX(z + step) - roadCenterX(z - step)) / (step * 2);
  return Math.atan(dx);
}

export function roadPitch(z) {
  const step = 1;
  const dy = (roadElevation(z + step) - roadElevation(z - step)) / (step * 2);
  return -Math.atan(dy);
}

export function roadPoint(z, lateral = 0, height = 0, target = new THREE.Vector3()) {
  const yaw = roadYaw(z);
  target.set(
    roadCenterX(z) + Math.cos(yaw) * lateral,
    roadElevation(z) + height,
    z - Math.sin(yaw) * lateral,
  );
  return target;
}

export function placeOnRoad(object, z, lateral = 0, height = 0) {
  roadPoint(z, lateral, height, object.position);
  object.rotation.set(roadPitch(z), roadYaw(z), 0);
  return object;
}
