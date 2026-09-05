import * as THREE from 'three';
const axle = new THREE.Vector3(1, 0, 0);
const spin = new THREE.Quaternion();
// Steering is a parent-space rotation; rolling preserves the imported bind pose.
export function rigWheel(wheel, front) {
  const pivot = new THREE.Group();
  pivot.position.copy(wheel.position);
  wheel.parent.add(pivot);
  pivot.add(wheel);
  wheel.position.set(0, 0, 0);
  const base = wheel.quaternion.clone();
  for (const child of [...wheel.children]) if (/^brake/i.test(child.name)) {
    wheel.updateWorldMatrix(true, true);
    pivot.attach(child);
  }
  return { wheel, pivot, base, front, angle: 0 };
}
export function animateWheel(rig, speed, steering, dt, rearLocked = false) {
  if (rig.front || !rearLocked) rig.angle = (rig.angle + speed * dt / 0.36) % (Math.PI * 2);
  rig.pivot.rotation.y = rig.front ? steering : 0;
  spin.setFromAxisAngle(axle, rig.angle);
  rig.wheel.quaternion.copy(spin).multiply(rig.base);
}
