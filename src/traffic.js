import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { LANE_X } from './road.js';
import { roadPitch, roadPoint, roadYaw } from './path.js';
import { GRAPHICS } from './platform.js';
import { rampSurfaceLift } from './features.js';
import { RACE_DIFFICULTIES, RACE_DISTANCE, RACER_NAMES } from './race.js';

// AI traffic: pooled vehicles (real Ferrari GLB clones with varied paint) in lanes at varied speeds
export const COLORS = [0x2878d4, 0x20a15a, 0xe0a126, 0x777777, 0x8a2f2f, 0x3f3f46, 0xb8b8b8, 0x292f52];

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
    this.headlightMaterial = hlMat;

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
        mesh: g, lane: 0, targetLane: 0, x: 0, z: 0, speed: 0,
        halfW: 0.95, halfL: 2.2,
        passed: false, laneTimer: 0, collisionCooldown: 0,
        racerIndex: -1, finished: false, nitroTimer: 0, nitroCooldown: 0,
        mistakeTimer: 0, mistakeCooldown: 0, nitroActive: false,
      });
    }
    this.spawnTimer = 0;
    this.raceMode = false;

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
        for (const lx of [-0.61, 0.61]) {
          const lens = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.075, 0.035), this.headlightMaterial);
          lens.position.set(lx, 0.72, -2.16);
          car.mesh.add(lens);
        }
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
    if (this.raceMode) return;
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
    this.raceMode = false;
    for (const car of this.cars) {
      car.mesh.visible = false;
      car.racerIndex = -1;
    }
  }

  setNightFactor(factor) {
    const night = THREE.MathUtils.clamp(factor, 0, 1);
    this.headlightMaterial.emissiveIntensity = 0.45 + night * 5.2;
  }

  resetRace(difficulty = 'normal') {
    this.raceMode = true;
    this.raceDifficulty = RACE_DIFFICULTIES[difficulty] ? difficulty : 'normal';
    const grid = [
      { lane: 0, z: -2.2, speed: 0 },
      { lane: 2, z: -2.2, speed: 0 },
      { lane: 1, z: -8.4, speed: 0 },
    ];
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (i >= 3) {
        car.mesh.visible = false;
        car.racerIndex = -1;
        continue;
      }
      const slot = grid[i];
      car.racerIndex = i;
      car.lane = slot.lane;
      car.targetLane = slot.lane;
      car.x = LANE_X[slot.lane];
      car.z = slot.z;
      car.speed = slot.speed;
      car.finished = false;
      car.laneTimer = 0.8 + i * 0.45;
      car.collisionCooldown = 0;
      car.nitroTimer = 0;
      car.nitroCooldown = 5.5 + i * 1.7;
      car.mistakeTimer = 0;
      car.mistakeCooldown = 12 + i * 5;
      car.nitroActive = false;
      car.mesh.visible = true;
      roadPoint(car.z, car.x, rampSurfaceLift(car.z), car.mesh.position);
      car.mesh.rotation.set(roadPitch(car.z), roadYaw(car.z), 0);
    }
  }

  updateRace(dt, player, running, onCrash) {
    if (!this.raceMode) return;
    const difficulty = RACE_DIFFICULTIES[this.raceDifficulty] || RACE_DIFFICULTIES.normal;
    const playerProgress = Math.max(0, -player.z);
    for (let i = 0; i < 3; i++) {
      const car = this.cars[i];
      if (!car?.mesh.visible) continue;
      car.collisionCooldown = Math.max(0, car.collisionCooldown - dt);

      if (running) {
        const racerProgress = Math.max(0, -car.z);
        const baseSpeed = [55.5, 53.8, 54.8][i] * difficulty.speedScale;
        const rubberBand = Math.max(-4, Math.min(
          difficulty.maxCatchup,
          (playerProgress - racerProgress) * difficulty.rubberBand,
        ));
        car.nitroCooldown -= dt;
        car.mistakeCooldown -= dt;
        car.nitroTimer = Math.max(0, car.nitroTimer - dt);
        car.mistakeTimer = Math.max(0, car.mistakeTimer - dt);

        // Rivals save boost for overtakes and long catch-up runs instead of
        // receiving an invisible permanent speed advantage.
        if (car.nitroCooldown <= 0 && (
          playerProgress - racerProgress > 12 ||
          Math.floor(racerProgress / 420 + i * 2) % 5 === 1
        )) {
          car.nitroTimer = 1.1 + i * 0.14;
          car.nitroCooldown = (10.5 + i * 1.4) / difficulty.nitroRate;
        }
        car.nitroActive = car.nitroTimer > 0;

        // Small, infrequent errors make rivals feel human and give the player
        // genuine passing windows. Easier opponents make them more often.
        if (car.mistakeCooldown <= 0 && Math.random() < dt * 0.75 * difficulty.mistakeRate) {
          car.mistakeTimer = 0.75 + Math.random() * 0.65;
          car.mistakeCooldown = (16 + Math.random() * 16) / difficulty.mistakeRate;
        }
        const finishEase = racerProgress > RACE_DISTANCE ? 0.82 : 1;
        const boost = car.nitroActive ? 8.5 : 0;
        const mistakeLoss = car.mistakeTimer > 0 ? 11 : 0;
        const targetSpeed = (baseSpeed + rubberBand + boost - mistakeLoss) * finishEase;
        car.speed += Math.max(-9 * dt, Math.min(difficulty.acceleration * dt, targetSpeed - car.speed));

        car.laneTimer -= dt;
        if (car.laneTimer <= 0) {
          car.laneTimer = (1.05 + ((i * 0.73 + racerProgress * 0.01) % 0.85)) * difficulty.reaction;
          const playerLane = LANE_X.reduce((best, laneX, lane) => (
            Math.abs(laneX - player.x) < Math.abs(LANE_X[best] - player.x) ? lane : best
          ), 0);
          const laneClear = (lane) => {
            if (lane === playerLane && Math.abs(player.z - car.z) < 14) return false;
            return this.cars.slice(0, 3).every((other) => (
              other === car || other.targetLane !== lane || Math.abs(other.z - car.z) > 14
            ));
          };
          const rivalAhead = this.cars.slice(0, 3).some((other) => (
            other !== car && other.targetLane === car.targetLane && other.z < car.z && car.z - other.z < 22
          ));
          const playerAhead = playerLane === car.targetLane && player.z < car.z && car.z - player.z < 22;
          const blockedAhead = rivalAhead || playerAhead;
          const safeLanes = [0, 1, 2].filter(laneClear);

          if (blockedAhead && safeLanes.length) {
            // Prefer an adjacent passing lane; jumping across the entire road
            // made the old traffic look robotic.
            const passingLanes = safeLanes.filter((lane) => lane !== car.targetLane);
            passingLanes.sort((a, b) => Math.abs(a - car.targetLane) - Math.abs(b - car.targetLane));
            if (passingLanes.length) car.targetLane = passingLanes[0];
          } else {
            const playerClosing = player.z > car.z && player.z - car.z < 24;
            const defend = playerClosing && difficulty !== RACE_DIFFICULTIES.easy && laneClear(playerLane);
            if (defend) car.targetLane = playerLane;
            else if (car.mistakeTimer > 0 && safeLanes.length) {
              car.targetLane = safeLanes[(i + Math.floor(racerProgress / 300)) % safeLanes.length];
            }
          }
        }

        car.x += (LANE_X[car.targetLane] - car.x) * Math.min(1, dt * (car.mistakeTimer > 0 ? 0.72 : 1.35));
        car.z -= car.speed * dt;
        if (-car.z >= RACE_DISTANCE) car.finished = true;
      }

      roadPoint(car.z, car.x, rampSurfaceLift(car.z), car.mesh.position);
      car.mesh.rotation.set(roadPitch(car.z), roadYaw(car.z), 0);

      const dx = Math.abs(car.x - player.x);
      const dz = Math.abs(car.z - player.z);
      if (running && car.collisionCooldown <= 0 && dx < car.halfW + 0.92 && dz < car.halfL + 2.15) {
        car.collisionCooldown = 0.85;
        car.speed *= 0.82;
        onCrash(car);
      }
    }
  }

  getRaceStandings(playerZ) {
    const entries = [{ name: RACER_NAMES[0], progress: Math.max(0, -playerZ), player: true }];
    for (let i = 0; i < 3; i++) {
      const car = this.cars[i];
      entries.push({
        name: RACER_NAMES[i + 1],
        progress: Math.max(0, -car.z),
        player: false,
        x: car.x,
        z: car.z,
        speed: car.speed,
        color: COLORS[i],
      });
    }
    entries.sort((a, b) => b.progress - a.progress);
    return entries;
  }
}
