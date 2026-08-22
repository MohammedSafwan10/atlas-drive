import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { LANE_X } from './road.js';
import { roadPitch, roadPoint, roadYaw } from './path.js';
import { GRAPHICS } from './platform.js';

// AI traffic: pooled vehicles (real Ferrari GLB clones with varied paint) in lanes at varied speeds
const COLORS = [0x3a6ea5, 0x777777, 0x8a2f2f, 0x2f5e3a, 0x3f3f46, 0xb8b8b8, 0x8a7a2f, 0x2f2f38];

export class Traffic {
  constructor(scene) {
    this.cars = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0a1420, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.9 });
    const hlMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff6d8, emissiveIntensity: 1.4 });
    const tlMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2211, emissiveIntensity: 1.0 });

    const bodyGeo = new THREE.BoxGeometry(1.9, 0.55, 4.4);
    const cabinGeo = new THREE.BoxGeometry(1.65, 0.5, 2.0);
    const roofGeo = new THREE.BoxGeometry(1.55, 0.1, 1.5);
    const hlGeo = new THREE.BoxGeometry(0.42, 0.12, 0.06);
    const tlGeo = new THREE.BoxGeometry(0.45, 0.12, 0.06);
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14);
    wheelGeo.rotateZ(Math.PI / 2);

    for (let i = 0; i < GRAPHICS.trafficCount; i++) {
      const color = COLORS[i % COLORS.length];
      const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.8, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 });

      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, paint);
      body.position.y = 0.55;
      body.castShadow = true;
      const cabin = new THREE.Mesh(cabinGeo, glassMat);
      cabin.position.set(0, 1.08, 0.25);
      const roof = new THREE.Mesh(roofGeo, paint);
      roof.position.set(0, 1.36, 0.3);
      g.add(body, cabin, roof);

      for (const lx of [-0.62, 0.62]) {
        const hl = new THREE.Mesh(hlGeo, hlMat);
        hl.position.set(lx, 0.78, -2.21);
        const tl = new THREE.Mesh(tlGeo, tlMat);
        tl.position.set(lx, 0.82, 2.26);
        g.add(hl, tl);
      }

      for (const [wx, wz] of [[-0.88, -1.45], [0.88, -1.45], [-0.88, 1.5], [0.88, 1.5]]) {
        const w = new THREE.Mesh(wheelGeo, tireMat);
        w.position.set(wx, 0.36, wz);
        g.add(w);
      }

      g.visible = false;
      this.group.add(g);
      this.cars.push({
        mesh: g, lane: 0, z: 0, speed: 0,
        halfW: 0.95, halfL: 2.2,
        passed: false,
      });
    }
    this.spawnTimer = 0;

    // ---- Upgrade pool to real GLB models once loaded ----
    const draco = new DRACOLoader();
    draco.setDecoderPath('/assets/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load('/assets/ferrari.glb', (gltf) => {
      const template = gltf.scene.children[0];
      const details = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.5 });
      const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.25, roughness: 0, transmission: 1.0 });

      for (let i = 0; i < this.cars.length; i++) {
        const car = this.cars[i];
        const model = template.clone(true);
        model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

        const paint = new THREE.MeshPhysicalMaterial({
          color: COLORS[i % COLORS.length], metalness: 1.0, roughness: 0.5,
          clearcoat: 1.0, clearcoatRoughness: 0.03,
        });
        const bodyPart = model.getObjectByName('body');
        if (bodyPart) bodyPart.material = paint;
        for (const rimName of ['rim_fl', 'rim_fr', 'rim_rl', 'rim_rr', 'trim']) {
          const p = model.getObjectByName(rimName);
          if (p) p.material = details;
        }
        const glassPart = model.getObjectByName('glass');
        if (glassPart) glassPart.material = glass;

        car.mesh.clear();
        car.mesh.add(model);
      }
      draco.dispose();
    }, undefined, () => draco.dispose());
  }

  spawn(playerZ) {
    const car = this.cars.find(c => !c.mesh.visible);
    if (!car) return;
    const lane = Math.floor(Math.random() * 3);
    car.lane = lane;
    car.z = playerZ - 180 - Math.random() * 120;
    car.speed = 16 + Math.random() * 14; // 58–108 km/h
    car.passed = false;
    car.mesh.visible = true;
  }

  update(dt, playerZ, playerX, onNearMiss, onCrash) {
    // Maintain traffic density
    this.spawnTimer -= dt;
    let active = 0;
    for (const car of this.cars) if (car.mesh.visible) active += 1;
    if (active < GRAPHICS.trafficCount && this.spawnTimer <= 0) {
      this.spawn(playerZ);
      this.spawnTimer = 0.5;
    }

    for (const car of this.cars) {
      if (!car.mesh.visible) continue;
      car.z -= car.speed * dt; // traffic drives toward -Z, same direction as player
      roadPoint(car.z, LANE_X[car.lane], 0, car.mesh.position);
      car.mesh.rotation.set(roadPitch(car.z), roadYaw(car.z), 0);

      // Despawn behind
      if (car.z > playerZ + 40) {
        car.mesh.visible = false;
        continue;
      }

      const dx = Math.abs(LANE_X[car.lane] - playerX);
      const dz = Math.abs(car.z - playerZ);

      // Collision (AABB)
      if (dx < car.halfW + 0.95 && dz < car.halfL + 2.2) {
        onCrash();
      }

      // Near miss: passed closely without collision
      if (!car.passed && car.z > playerZ + 2.5) {
        car.passed = true;
        if (dx < 2.2) onNearMiss();
      }
    }
  }

  reset() {
    for (const car of this.cars) {
      car.mesh.visible = false;
    }
  }
}
