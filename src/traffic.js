import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { LANE_X } from './road.js';
import { roadPitch, roadPoint, roadYaw, SEG_LEN } from './path.js';
import { GRAPHICS, IS_MOBILE } from './platform.js';
import { modeForSegment, rampSurfaceLift } from './features.js';
import { RACE_DIFFICULTIES, RACE_DISTANCE, RACER_NAMES } from './race.js';

// AI traffic: pooled vehicles (real Ferrari GLB clones with varied paint) in lanes at varied speeds
export const COLORS = [0x2878d4, 0x20a15a, 0xe0a126, 0x777777, 0x8a2f2f, 0x3f3f46, 0xb8b8b8, 0x292f52];

const clamp = THREE.MathUtils.clamp;

function angleDelta(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function trackKnowledge(z) {
  const nearYaw = roadYaw(z - 24);
  const currentYaw = roadYaw(z + 12);
  const farYaw = roadYaw(z - 82);
  const nearTurn = angleDelta(nearYaw, currentYaw);
  const approachingTurn = angleDelta(farYaw, nearYaw);
  const severity = Math.max(Math.abs(nearTurn), Math.abs(approachingTurn) * 0.82);
  // Approach from the outside, clip toward the apex, then naturally unwind as
  // the sampled curvature moves behind the car.
  const racingLine = clamp(nearTurn * 120 - approachingTurn * 35, -3.75, 3.75);
  return { severity, racingLine };
}

function makeNitroGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(235,250,255,1)');
  gradient.addColorStop(0.18, 'rgba(69,174,255,.92)');
  gradient.addColorStop(0.52, 'rgba(20,103,255,.32)');
  gradient.addColorStop(1, 'rgba(0,45,180,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

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

    // Rival effects are slightly larger than the player's physically-sized
    // flames so they remain readable several car lengths down the road.
    const nitroOuterGeo = new THREE.ConeGeometry(0.09, 0.68, 12, 1, true);
    const nitroCoreGeo = new THREE.ConeGeometry(0.042, 0.4, 10, 1, true);
    nitroOuterGeo.rotateX(Math.PI / 2);
    nitroCoreGeo.rotateX(Math.PI / 2);
    const nitroOuterMat = new THREE.MeshBasicMaterial({
      color: 0x5aaeff, transparent: true, opacity: 0.72,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const nitroCoreMat = new THREE.MeshBasicMaterial({
      color: 0xf3fbff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const nitroGlowMat = new THREE.SpriteMaterial({
      map: makeNitroGlowTexture(), color: 0x75c6ff,
      transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: true,
    });

    const attachHeadlightBeams = (car) => {
      car.headlightBeams = [];
      // Race rivals need real road illumination, not merely glowing lens meshes.
      // Two unshadowed spots are inexpensive; mobile disables distant beams.
      for (const lx of [-0.56, 0.56]) {
        const beam = new THREE.SpotLight(0xffedcf, 0, IS_MOBILE ? 30 : 40, 0.31, 0.72, 1.45);
        beam.position.set(lx, 0.7, -2.05);
        beam.target.position.set(lx * 0.55, 0.03, -19);
        beam.castShadow = false;
        car.mesh.add(beam, beam.target);
        car.headlightBeams.push(beam);
      }
    };

    const attachNitroFX = (car) => {
      if (!car.nitroFX) {
        car.nitroFX = new THREE.Group();
        car.nitroFlames = [];
        for (const lx of [-0.2, 0, 0.2]) {
          const flame = new THREE.Group();
          const outer = new THREE.Mesh(nitroOuterGeo, nitroOuterMat);
          const core = new THREE.Mesh(nitroCoreGeo, nitroCoreMat);
          outer.position.z = 0.2;
          core.position.z = 0.12;
          flame.position.set(lx, 0.31, 2.3);
          flame.add(outer, core);
          car.nitroFX.add(flame);
          car.nitroFlames.push(flame);
        }
        car.nitroGlow = new THREE.Sprite(nitroGlowMat);
        car.nitroGlow.position.set(0, 0.34, 2.66);
        car.nitroGlow.scale.set(1.15, 0.72, 1);
        car.nitroFX.add(car.nitroGlow);
        car.nitroLight = new THREE.PointLight(0x2d8cff, 0.85, 5, 2);
        car.nitroLight.position.set(0, 0.36, 2.48);
        car.nitroFX.add(car.nitroLight);
      }
      car.nitroFX.visible = false;
      car.mesh.add(car.nitroFX);
    };

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
      const carEntry = {
        mesh: g, lane: 0, targetLane: 0, x: 0, z: 0, speed: 0,
        halfW: 0.95, halfL: 2.2,
        passed: false, laneTimer: 0, collisionCooldown: 0,
        racerIndex: -1, finished: false, nitroTimer: 0, nitroCooldown: 0,
        nitroAmount: 1, nitroActive: false, nitroFX: null, nitroFlames: [],
        mistakeTimer: 0, mistakeCooldown: 0, headlightBeams: [],
        raceElapsed: 0, targetX: 0, lateralVelocity: 0, tacticalState: 'RACING_LINE',
      };
      this.cars.push(carEntry);
      attachHeadlightBeams(carEntry);
      attachNitroFX(carEntry);
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
        attachHeadlightBeams(car);
        attachNitroFX(car);
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
      car.nitroActive = false;
      if (car.nitroFX) car.nitroFX.visible = false;
    }
  }

  setNightFactor(factor, playerZ = 0) {
    const night = THREE.MathUtils.clamp(factor, 0, 1);
    this.headlightMaterial.emissiveIntensity = 0.45 + night * 5.2;
    for (const car of this.cars) {
      const closeEnough = !IS_MOBILE || Math.abs(car.z - playerZ) < 95;
      for (const beam of car.headlightBeams || []) {
        beam.intensity = car.mesh.visible && closeEnough ? night * 145 : 0;
      }
    }
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
      car.nitroCooldown = 1.4 + i * 0.65;
      car.nitroAmount = 0.82 + i * 0.09;
      car.mistakeTimer = 0;
      car.mistakeCooldown = 12 + i * 5;
      car.nitroActive = false;
      if (car.nitroFX) car.nitroFX.visible = false;
      car.raceElapsed = 0;
      car.targetX = car.x;
      car.lateralVelocity = 0;
      car.tacticalState = 'RACING_LINE';
      car.mesh.visible = true;
      roadPoint(car.z, car.x, rampSurfaceLift(car.z), car.mesh.position);
      car.mesh.rotation.set(roadPitch(car.z), roadYaw(car.z), 0);
    }
  }

  updateRace(dt, player, running, onCrash) {
    if (!this.raceMode) return;
    const difficulty = RACE_DIFFICULTIES[this.raceDifficulty] || RACE_DIFFICULTIES.normal;
    const playerProgress = Math.max(0, -player.z);
    const playerLane = LANE_X.reduce((best, laneX, lane) => (
      Math.abs(laneX - player.x) < Math.abs(LANE_X[best] - player.x) ? lane : best
    ), 0);

    for (let i = 0; i < 3; i++) {
      const car = this.cars[i];
      if (!car?.mesh.visible) continue;
      car.collisionCooldown = Math.max(0, car.collisionCooldown - dt);

      if (running) {
        car.raceElapsed += dt;
        const racerProgress = Math.max(0, -car.z);
        const racePhase = clamp(racerProgress / RACE_DISTANCE, 0, 1);
        const knowledge = trackKnowledge(car.z);
        const feature = modeForSegment(Math.round((car.z - 42) / SEG_LEN));
        const rivals = this.cars.slice(0, 3).filter((other) => other !== car && other.mesh.visible);
        const entities = [...rivals, {
          x: player.x, z: player.z, speed: player.speed,
          targetLane: playerLane, player: true,
        }];

        // Predict relative positions roughly one second ahead. Lanes with an
        // imminent overlap are rejected; merely slower lanes receive a softer
        // penalty so the racer can deliberately draft before passing.
        const scoreLane = (lane) => {
          const laneX = LANE_X[lane];
          let score = -Math.abs(laneX - knowledge.racingLine) * (0.8 + difficulty.lineSkill * 1.4);
          score -= Math.abs(lane - car.targetLane) * 0.7;
          let closestAhead = Number.POSITIVE_INFINITY;
          let aheadSpeed = difficulty.maxSpeed;
          let danger = false;

          for (const other of entities) {
            if (Math.abs(other.x - laneX) > 2.15) continue;
            const gapAhead = car.z - other.z;
            const closingSpeed = car.speed - other.speed;
            const predictedGap = gapAhead - closingSpeed * (0.85 + difficulty.lineSkill * 0.45);
            if (Math.abs(predictedGap) < 7.6 || Math.abs(gapAhead) < 6.8) {
              score -= 120;
              danger = true;
            }
            if (gapAhead > 0 && gapAhead < 48) {
              if (gapAhead < closestAhead) {
                closestAhead = gapAhead;
                aheadSpeed = other.speed;
              }
              score -= (48 - gapAhead) * Math.max(0.08, closingSpeed * 0.055);
            } else if (gapAhead < 0 && gapAhead > -22) {
              score -= (22 + gapAhead) * 0.7;
            }
          }
          return { lane, score, closestAhead, aheadSpeed, danger };
        };

        let laneOptions = [0, 1, 2].map(scoreLane);
        const currentOption = laneOptions[car.targetLane];
        const blockedAhead = currentOption.closestAhead < 31;
        const playerClosing = player.z > car.z && player.z - car.z < 25 && player.speed > car.speed - 2;

        car.laneTimer -= dt;
        if (car.laneTimer <= 0) {
          car.laneTimer = difficulty.decisionTime * (0.86 + ((i * 0.37 + racerProgress * 0.0031) % 0.34));

          if (blockedAhead) {
            // A real pass is worth committing to; adjacent lanes are preferred
            // over robotic full-width jumps unless the nearer option is unsafe.
            for (const option of laneOptions) {
              if (option.lane !== car.targetLane) option.score += 8.5 * difficulty.aggression;
              option.score -= Math.max(0, Math.abs(option.lane - car.targetLane) - 1) * 3.5;
            }
          }
          if (playerClosing && this.raceDifficulty !== 'easy') {
            laneOptions[playerLane].score += 4.2 * difficulty.aggression;
          }

          laneOptions.sort((a, b) => b.score - a.score);
          const choice = laneOptions[0];
          const previousLane = car.targetLane;
          if (!choice.danger || currentOption.danger) car.targetLane = choice.lane;
          if (blockedAhead && car.targetLane !== previousLane) car.tacticalState = 'OVERTAKE';
          else if (playerClosing && car.targetLane === playerLane) car.tacticalState = 'DEFEND';
          else car.tacticalState = 'RACING_LINE';
        }

        // Re-score after a decision so speed and nitro use respect the newly
        // selected lane rather than the lane occupied at the frame's start.
        laneOptions = [0, 1, 2].map(scoreLane);
        const selected = laneOptions[car.targetLane];
        const fineLineOffset = clamp(knowledge.racingLine - LANE_X[car.targetLane], -0.72, 0.72);
        car.targetX = LANE_X[car.targetLane] + fineLineOffset * difficulty.lineSkill;

        const draftTarget = entities.find((other) => {
          const gap = car.z - other.z;
          return gap > 8 && gap < 29 && Math.abs(other.x - car.x) < 1.35;
        });
        const drafting = Boolean(draftTarget) && !selected.danger;
        if (drafting && car.tacticalState === 'RACING_LINE') car.tacticalState = 'DRAFT';

        // Each driver has a bounded race-phase target. This creates a strong
        // leader, a battling midfielder and a late challenger without giving
        // anybody an unlimited invisible catch-up speed.
        const desiredStartGap = [34, 15, -4][i];
        const desiredFinishGap = [9, -3, -17][i];
        const desiredGap = THREE.MathUtils.lerp(desiredStartGap, desiredFinishGap, racePhase);
        const actualGap = racerProgress - playerProgress;
        const paceError = desiredGap - actualGap;
        const adaptivePace = clamp(
          paceError * difficulty.paceGain,
          -difficulty.maxSlowdown,
          difficulty.maxCatchup,
        );

        car.nitroCooldown = Math.max(0, car.nitroCooldown - dt);
        car.mistakeCooldown -= dt;
        car.nitroTimer = Math.max(0, car.nitroTimer - dt);
        car.mistakeTimer = Math.max(0, car.mistakeTimer - dt);

        const straightEnough = knowledge.severity < 0.035 && feature !== 'ramp';
        const alignedForPass = Math.abs(car.x - car.targetX) < 1.1;
        const needsCatchup = playerProgress - racerProgress > 16;
        const passingChance = car.tacticalState === 'OVERTAKE' && alignedForPass && !selected.danger;
        const finalAttack = racePhase > 0.82 && actualGap < 30;
        const launchAttack = car.raceElapsed > 1.2 && car.raceElapsed < 5.8 && i !== 2;
        const wantsNitro = straightEnough && (passingChance || needsCatchup || finalAttack || launchAttack);

        if (!car.nitroActive && car.nitroCooldown <= 0 && car.nitroAmount > 0.2 && wantsNitro) {
          car.nitroActive = true;
          car.nitroTimer = 0.72 + difficulty.nitroRate * 0.7;
          car.tacticalState = passingChance ? 'NITRO PASS' : finalAttack ? 'FINAL ATTACK' : 'BOOST';
        }
        if (car.nitroActive) {
          car.nitroAmount = Math.max(0, car.nitroAmount - dt * (0.25 + (1 - difficulty.nitroRate) * 0.04));
          if (car.nitroAmount <= 0.015 || (!straightEnough && car.nitroTimer <= 0) || (car.nitroTimer <= 0 && !wantsNitro)) {
            car.nitroActive = false;
            car.nitroCooldown = 3.6 - difficulty.nitroRate * 1.2;
          }
        } else {
          car.nitroAmount = Math.min(1, car.nitroAmount + dt * (drafting ? 0.085 : 0.045));
        }

        // Small, infrequent errors make rivals feel human and give the player
        // genuine passing windows. Easier opponents make them more often.
        if (car.mistakeCooldown <= 0 && Math.random() < dt * 0.75 * difficulty.mistakeRate) {
          car.mistakeTimer = 0.75 + Math.random() * 0.65;
          car.mistakeCooldown = (16 + Math.random() * 16) / difficulty.mistakeRate;
        }
        const curvePenalty = Math.min(12, knowledge.severity * (82 - difficulty.lineSkill * 24));
        const featurePenalty = feature === 'ramp' ? 3.5 : 0;
        const launchPace = Math.max(0, 6.5 - car.raceElapsed) * (0.72 + difficulty.aggression * 0.25);
        const personality = [1.1, -0.7, 0.25][i];
        const boost = car.nitroActive ? 13.5 : 0;
        const draftBonus = drafting ? 1.6 : 0;
        const mistakeLoss = car.mistakeTimer > 0 ? 8 + 5 * difficulty.mistakeRate : 0;
        let targetSpeed = difficulty.cruiseSpeed + personality + adaptivePace + launchPace
          + boost + draftBonus - curvePenalty - featurePenalty - mistakeLoss;
        if (selected.closestAhead < 18 && selected.aheadSpeed < targetSpeed && car.tacticalState !== 'OVERTAKE') {
          targetSpeed = Math.min(targetSpeed, selected.aheadSpeed + Math.max(0, (selected.closestAhead - 7) * 0.32));
        }
        if (racerProgress > RACE_DISTANCE) targetSpeed *= 0.82;
        targetSpeed = Math.min(targetSpeed, difficulty.maxSpeed);

        const speedDelta = targetSpeed - car.speed;
        const acceleration = difficulty.acceleration * (car.nitroActive ? 1.65 : 1);
        car.speed += clamp(speedDelta, -18 * dt, acceleration * dt);

        const previousX = car.x;
        const lateralResponse = car.mistakeTimer > 0 ? 0.82 : 1.7 + difficulty.lineSkill * 0.85;
        car.x += (car.targetX - car.x) * Math.min(1, dt * lateralResponse);
        car.lateralVelocity += (((car.x - previousX) / Math.max(dt, 0.001)) - car.lateralVelocity) * Math.min(1, dt * 6);
        car.z -= car.speed * dt;
        if (-car.z >= RACE_DISTANCE) car.finished = true;
      }

      roadPoint(car.z, car.x, rampSurfaceLift(car.z), car.mesh.position);
      const steerYaw = clamp(car.lateralVelocity * -0.012, -0.055, 0.055);
      const bodyRoll = clamp(car.lateralVelocity * -0.008, -0.035, 0.035);
      car.mesh.rotation.set(roadPitch(car.z), roadYaw(car.z) + steerYaw, bodyRoll);

      if (car.nitroFX) {
        car.nitroFX.visible = running && car.nitroActive;
        if (car.nitroFX.visible) {
          const time = performance.now() * 0.001;
          const pulse = 0.94 + Math.sin(time * 23 + i) * 0.08;
          car.nitroGlow.scale.set(1.15 * pulse, 0.72 * pulse, 1);
          car.nitroLight.intensity = 0.72 + pulse * 0.28;
          for (let flame = 0; flame < car.nitroFlames.length; flame++) {
            const flicker = 0.9 + Math.sin(time * 29 + i * 2.1 + flame) * 0.12;
            car.nitroFlames[flame].scale.set(flicker, flicker, 0.88 + flicker * 0.22);
          }
        }
      }

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
