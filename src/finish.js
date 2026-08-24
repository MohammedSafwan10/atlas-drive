import * as THREE from 'three';
import { IS_MOBILE } from './platform.js';
import { roadPoint, roadYaw } from './path.js';
import { RACER_NAMES, RACE_DISTANCE } from './race.js';

function makeLabelTexture(text, accent) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#080d14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, canvas.width, 14);
  ctx.font = '900 104px Segoe UI, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 108);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class FinishPresentation {
  constructor(scene) {
    this.scene = scene;
    this.timer = 0;
    this.active = false;
    this.podiumShown = false;
    this.originZ = -RACE_DISTANCE - 28;
    this.target = new THREE.Vector3();
    this.podium = new THREE.Group();
    this.podium.visible = false;
    scene.add(this.podium);

    const blockMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x242a31, roughness: 0.28, metalness: 0.62, clearcoat: 0.42,
    });
    const heights = [1.05, 1.7, 0.72];
    const places = ['2', '1', '3'];
    const accents = ['#a8b4c0', '#f2bf43', '#ad7446'];
    for (let i = 0; i < 3; i++) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(4.25, heights[i], 6.2), blockMaterial.clone());
      block.position.set((i - 1) * 4.35, heights[i] / 2, 0);
      block.castShadow = !IS_MOBILE;
      block.receiveShadow = true;
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(1.8, 0.68),
        new THREE.MeshBasicMaterial({ map: makeLabelTexture(places[i], accents[i]), toneMapped: false }),
      );
      label.position.set(block.position.x, heights[i] * 0.56, 3.115);
      this.podium.add(block, label);
    }

    const beam = new THREE.SpotLight(0xffd887, 45, 38, 0.48, 0.75, 1.5);
    beam.position.set(0, 13, 7);
    beam.target.position.set(0, 0, 0);
    beam.castShadow = false;
    this.podium.add(beam, beam.target);

    const confettiCount = IS_MOBILE ? 120 : 360;
    this.confettiPositions = new Float32Array(confettiCount * 3);
    this.confettiVelocity = new Float32Array(confettiCount * 3);
    this.confettiColors = new Float32Array(confettiCount * 3);
    const palette = [new THREE.Color(0x28baff), new THREE.Color(0xffd047), new THREE.Color(0xff405a), new THREE.Color(0xffffff)];
    for (let i = 0; i < confettiCount; i++) {
      const color = palette[i % palette.length];
      this.confettiColors.set(color.toArray(), i * 3);
      this._resetConfetti(i, true);
    }
    const confettiGeometry = new THREE.BufferGeometry();
    confettiGeometry.setAttribute('position', new THREE.BufferAttribute(this.confettiPositions, 3));
    confettiGeometry.setAttribute('color', new THREE.BufferAttribute(this.confettiColors, 3));
    this.confetti = new THREE.Points(confettiGeometry, new THREE.PointsMaterial({
      size: 0.11, vertexColors: true, depthWrite: false, transparent: true, opacity: 0.9,
    }));
    this.podium.add(this.confetti);
  }

  _resetConfetti(i, initial = false) {
    this.confettiPositions[i * 3] = (Math.random() - 0.5) * 14;
    this.confettiPositions[i * 3 + 1] = initial ? Math.random() * 9 : 8 + Math.random() * 3;
    this.confettiPositions[i * 3 + 2] = (Math.random() - 0.5) * 7;
    this.confettiVelocity[i * 3] = (Math.random() - 0.5) * 0.8;
    this.confettiVelocity[i * 3 + 1] = -(0.7 + Math.random() * 1.4);
    this.confettiVelocity[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
  }

  start(player, traffic, standings) {
    this.active = true;
    this.timer = 0;
    this.player = player;
    this.traffic = traffic;
    this.standings = standings;
    this.startZ = player.z;
    this.podiumShown = false;
    this.podium.visible = false;
  }

  skipToPodium() {
    if (!this.active) return;
    this.timer = Math.max(this.timer, 3.35);
  }

  _placePodiumCars() {
    if (this.podiumShown) return;
    this.podiumShown = true;
    const point = roadPoint(this.originZ, 0, 0);
    this.podium.position.copy(point);
    this.podium.rotation.y = roadYaw(this.originZ);
    this.podium.visible = true;

    const objects = [this.player.group, ...this.traffic.cars.slice(0, 3).map((car) => car.mesh)];
    const slots = [
      { x: 0, y: 1.78, z: 0 },
      { x: -4.35, y: 1.13, z: 0 },
      { x: 4.35, y: 0.8, z: 0 },
      { x: 0, y: -100, z: 0 },
    ];
    this.standings.forEach((entry, rank) => {
      const racerIndex = RACER_NAMES.indexOf(entry.name);
      const object = objects[racerIndex];
      if (!object) return;
      const local = new THREE.Vector3(slots[rank].x, slots[rank].y, slots[rank].z);
      this.podium.localToWorld(local);
      object.position.copy(local);
      object.rotation.set(0, this.podium.rotation.y, 0);
      object.visible = rank < 3;
    });
  }

  _updateConfetti(dt) {
    for (let i = 0; i < this.confettiPositions.length / 3; i++) {
      this.confettiPositions[i * 3] += this.confettiVelocity[i * 3] * dt;
      this.confettiPositions[i * 3 + 1] += this.confettiVelocity[i * 3 + 1] * dt;
      this.confettiPositions[i * 3 + 2] += this.confettiVelocity[i * 3 + 2] * dt;
      if (this.confettiPositions[i * 3 + 1] < 0) this._resetConfetti(i);
    }
    this.confetti.geometry.attributes.position.needsUpdate = true;
  }

  update(dt, camera) {
    if (!this.active) return { complete: false, podium: false };
    this.timer += dt;
    const forward = new THREE.Vector3();
    if (this.timer < 1.2) {
      const t = this.timer / 1.2;
      const cameraPoint = roadPoint(this.startZ + 8 - t * 3, -4.4, 1.35);
      const look = roadPoint(this.startZ - 5, this.player.x, 0.8);
      camera.position.lerp(cameraPoint, Math.min(1, dt * 7));
      camera.lookAt(look);
    } else if (this.timer < 3.3) {
      const t = (this.timer - 1.2) / 2.1;
      const angle = THREE.MathUtils.lerp(-0.8, 0.5, t);
      forward.set(Math.sin(angle) * 8, 2.1 + Math.sin(t * Math.PI) * 1.2, Math.cos(angle) * 8);
      camera.position.copy(this.player.group.position).add(forward);
      camera.lookAt(this.player.group.position.x, this.player.group.position.y + 0.65, this.player.group.position.z);
    } else {
      this._placePodiumCars();
      this._updateConfetti(dt);
      const orbitTime = this.timer - 3.3;
      const angle = -0.45 + orbitTime * 0.24;
      const localCamera = new THREE.Vector3(Math.sin(angle) * 14, 5.2, Math.cos(angle) * 14);
      this.podium.localToWorld(localCamera);
      camera.position.copy(localCamera);
      this.podium.getWorldPosition(this.target);
      this.target.y += 1.25;
      camera.lookAt(this.target);
    }
    camera.fov += (58 - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
    return { complete: this.timer >= 7.2, podium: this.podiumShown };
  }

  stop() {
    this.active = false;
    this.podium.visible = false;
  }
}
