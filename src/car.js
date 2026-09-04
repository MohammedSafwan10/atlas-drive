import { integrateHandling } from './physics.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { SEG_LEN, roadPitch, roadPoint, roadYaw, roadCurvature } from './path.js';
import { modeForSegment, rampLips, rampSurfaceLift } from './features.js';

const GRAVITY = 16;
const RAMP_MIN_LAUNCH_SPEED = 16;

// Player car: real Ferrari GLB model (Draco) with procedural fallback
export class Car {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.wheels = [];
    this.taillights = [];
    this.modelReady = false;

    // Soft contact shadow anchors the car even beyond the sun shadow map.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const shadowContext = shadowCanvas.getContext('2d');
    const shadowGradient = shadowContext.createRadialGradient(64, 64, 8, 64, 64, 58);
    shadowGradient.addColorStop(0, 'rgba(0,0,0,0.58)');
    shadowGradient.addColorStop(0.55, 'rgba(0,0,0,0.28)');
    shadowGradient.addColorStop(1, 'rgba(0,0,0,0)');
    shadowContext.fillStyle = shadowGradient;
    shadowContext.fillRect(0, 0, 128, 128);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    const contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 5.2),
      new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.72 }),
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(0, 0.035, 0.15);
    contactShadow.renderOrder = 2;
    this.group.add(contactShadow);

    // ---- Procedural fallback (visible until GLB loads) ----
    const paint = new THREE.MeshPhysicalMaterial({
      color: 0xc41e3a, metalness: 0.85, roughness: 0.28, clearcoat: 1.0, clearcoatRoughness: 0.12,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x0a1420, metalness: 0.1, roughness: 0.08, transmission: 0.55, transparent: true, opacity: 0.92,
    });
    const trim = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.55, metalness: 0.4 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
    const rim = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.3, metalness: 0.9 });
    const headlightMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff6d8, emissiveIntensity: 1.6 });
    const taillightMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2211, emissiveIntensity: 1.2 });

    const fallback = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.4), paint);
    body.position.y = 0.55;
    body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.5, 2.0), glass);
    cabin.position.set(0, 1.08, 0.25);
    cabin.castShadow = true;
    fallback.add(body, cabin);

    for (const lx of [-0.62, 0.62]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.06), headlightMat);
      hl.position.set(lx, 0.78, -2.21);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.06), taillightMat);
      tl.position.set(lx, 0.82, 2.26);
      fallback.add(hl, tl);
      this.taillights.push(tl);
    }
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 20);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [wx, wz] of [[-0.88, -1.45], [0.88, -1.45], [-0.88, 1.5], [0.88, 1.5]]) {
      const w = new THREE.Mesh(wheelGeo, tire);
      w.position.set(wx, 0.36, wz);
      fallback.add(w);
      this.wheels.push(w);
    }
    this.group.add(fallback);
    this.fallback = fallback;

    // ---- Real model: Ferrari GLB with Draco compression ----
    const draco = new DRACOLoader();
    draco.setDecoderPath('/assets/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    this.ready = new Promise((resolve) => loader.load('/assets/ferrari.glb', (gltf) => {
      const carModel = gltf.scene.children[0];
      carModel.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });

      // PBR paint + details override for a rich, realistic look
      const bodyMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xc41e3a, metalness: 1.0, roughness: 0.5, clearcoat: 1.0, clearcoatRoughness: 0.03,
      });
      const detailsMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff, metalness: 1.0, roughness: 0.5,
      });
      const glassMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, metalness: 0.25, roughness: 0.12, transmission: 0,
      });
      const bodyPart = carModel.getObjectByName('body');
      if (bodyPart) bodyPart.material = bodyMaterial;
      for (const rimName of ['rim_fl', 'rim_fr', 'rim_rl', 'rim_rr', 'trim']) {
        const p = carModel.getObjectByName(rimName);
        if (p) p.material = detailsMaterial;
      }
      const glassPart = carModel.getObjectByName('glass');
      if (glassPart) glassPart.material = glassMaterial;

      const brakeMaterial = new THREE.MeshStandardMaterial({
        color: 0x420000, emissive: 0xff1608, emissiveIntensity: 1.2, roughness: 0.35,
      });
      for (const lx of [-0.61, 0.61]) {
        const brakeLight = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.045), brakeMaterial.clone());
        brakeLight.position.set(lx, 0.76, 2.19);
        carModel.add(brakeLight);
        this.taillights.push(brakeLight);
      }

      const gltfWheels = [
        carModel.getObjectByName('wheel_fl'),
        carModel.getObjectByName('wheel_fr'),
        carModel.getObjectByName('wheel_rl'),
        carModel.getObjectByName('wheel_rr'),
      ].filter(Boolean);

      // Model already faces -Z (our driving direction)
      carModel.rotation.y = 0;
      carModel.position.y = 0;

      this.group.add(carModel);
      this.wheels = gltfWheels;
      this.modelReady = true;
      fallback.visible = false;
      draco.dispose();
      resolve();
    }, undefined, (err) => {
      console.warn('Ferrari GLB failed to load, using fallback car', err);
      draco.dispose();
      resolve();
    }));

    // Twin focused headlight beams. These match the physical lamp positions and
    // avoid the flat, oversized cone produced by the former central spotlight.
    this.headlightBeams = [];
    this.nightFactor = 0;
    for (const lx of [-0.58, 0.58]) {
      const beam = new THREE.SpotLight(0xffedcf, 0.25, 44, 0.28, 0.68, 1.35);
      beam.position.set(lx, 0.72, -2.08);
      beam.target.position.set(lx * 0.65, 0.05, -22);
      beam.castShadow = false;
      this.group.add(beam, beam.target);
      this.headlightBeams.push(beam);
    }

    this.reset();
  }

  reset() {
    this.speed = 0;          // m/s
    this.x = 0;              // lateral position
    this.z = 0;
    this.steerAngle = 0;
    this.lateralVelocity = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.nitroAmount = 1.0;
    this.nitroActive = false;
    this.crashed = false;
    this.airborne = false;
    this.airY = 0;
    this.airVy = 0;
    this.airTime = 0;
    this.justLanded = false;
    this.lastAirTime = 0;
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.syncToRoad();
  }

  syncToRoad() {
    const surfaceLift = this.airborne || Math.abs(this.x) >= 3.4 ? 0 : rampSurfaceLift(this.z);
    roadPoint(this.z, this.x, (this.airY || 0) + surfaceLift, this.group.position);
    const airPitch = this.airborne ? -Math.atan2(this.airVy, Math.max(20, this.speed)) * 0.55 : 0;
    this.group.rotation.set(
      roadPitch(this.z) + airPitch + this.bodyPitch,
      roadYaw(this.z) - this.steerAngle * 0.055,
      this.bodyRoll,
    );
  }

  update(dt, input) {
    if (this.crashed) return;

    integrateHandling(this, input, dt, roadCurvature(this.z), this.wetness || 0);

    // Tactical ramp launch: crossing ramp lip within lateral span (-3.4 to +3.4)
    if (!this.airborne && this.speed > RAMP_MIN_LAUNCH_SPEED && Math.abs(this.x) < 3.4) {
      const lip = this.z - this.speed * dt; // z after this frame's move
      const k = Math.round(lip / SEG_LEN);
      if (modeForSegment(k) === 'ramp') {
        for (const edge of rampLips(k)) {
          if (this.z >= edge && lip < edge) {
            this.airborne = true;
            this.airTime = 0;
            this.airY = Math.max(this.airY, 1.35);
            this.airVy = 4.0 + this.speed * 0.095;
            // Reward stunt launch with instant +20% Nitro recharge!
            this.nitroAmount = Math.min(1, this.nitroAmount + 0.2);
            break;
          }
        }
      }
    }

    // Airborne integration
    if (this.airborne) {
      this.airTime += dt;
      this.airY += this.airVy * dt - 0.5 * GRAVITY * dt * dt;
      this.airVy -= GRAVITY * dt;
      if (this.airY <= 0 && this.airVy < 0) {
        this.airY = 0;
        this.airborne = false;
        if (this.airTime > 0.25) {
          this.justLanded = true;
          this.lastAirTime = this.airTime;
        }
      }
    }

    // Visual: yaw + body roll
    this.syncToRoad();

    for (const light of this.taillights) {
      light.material.emissiveIntensity = (input.brake || input.handbrake) ? 4.2 : 1.2;
      light.scale.set((input.brake || input.handbrake) ? 1.16 : 1, (input.brake || input.handbrake) ? 1.16 : 1, 1);
    }

    // Wheels spin + front steer
    const wheelSpin = (this.speed / 0.36) * dt;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      w.rotation.x -= wheelSpin;
      if (i < 2) w.rotation.y = -this.steerAngle * 0.06;
    }

    for (const beam of this.headlightBeams) beam.intensity = 0.25 + this.nightFactor * 210;
  }

  setNightFactor(factor) {
    this.nightFactor = THREE.MathUtils.clamp(factor, 0, 1);
    for (const beam of this.headlightBeams) beam.intensity = 0.25 + this.nightFactor * 210;
  }

  get kmh() { return Math.round(this.speed * 3.6); }
}
