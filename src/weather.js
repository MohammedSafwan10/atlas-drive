import * as THREE from 'three';
import { IS_MOBILE } from './platform.js';

export const WEATHER_MODES = ['auto', 'clear', 'storm'];

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

function makeRainMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xb9ddff,
    transparent: true,
    opacity: IS_MOBILE ? 0.3 : 0.38,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

function makeMistTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(220,238,250,.7)');
  gradient.addColorStop(0.35, 'rgba(180,210,230,.28)');
  gradient.addColorStop(1, 'rgba(150,190,215,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export class WeatherSystem {
  constructor(scene, camera, road, audio, applyWeather) {
    this.scene = scene;
    this.camera = camera;
    this.road = road;
    this.audio = audio;
    this.applyWeather = applyWeather;
    this.mode = 'auto';
    this.intensity = 0;
    this.targetIntensity = 0;
    this.autoTime = 0;
    this.lightningTimer = 8 + Math.random() * 10;
    this.lightningEnvelope = 0;
    this.thunderTimer = -1;
    this.wind = new THREE.Vector3(0.16, 0, 0.04);

    this.rainCount = IS_MOBILE ? 220 : 760;
    const geometry = new THREE.PlaneGeometry(IS_MOBILE ? 0.022 : 0.028, IS_MOBILE ? 1.45 : 2.05);
    this.rain = new THREE.InstancedMesh(geometry, makeRainMaterial(), this.rainCount);
    this.rain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rainDrops = [];
    for (let i = 0; i < this.rainCount; i++) {
      this.rainDrops.push({
        x: (Math.random() - 0.5) * 42,
        y: Math.random() * 24 - 4,
        z: Math.random() * 54 - 34,
        speed: 21 + Math.random() * 18,
        scale: 0.55 + Math.random() * 0.8,
      });
    }
    scene.add(this.rain);

    const sprayCount = IS_MOBILE ? 55 : 140;
    const sprayGeometry = new THREE.BufferGeometry();
    this.sprayPositions = new Float32Array(sprayCount * 3);
    this.sprayVelocity = new Float32Array(sprayCount * 3);
    this.sprayLife = new Float32Array(sprayCount);
    sprayGeometry.setAttribute('position', new THREE.BufferAttribute(this.sprayPositions, 3));
    this.spray = new THREE.Points(sprayGeometry, new THREE.PointsMaterial({
      map: makeMistTexture(), color: 0xd5e9f5, size: IS_MOBILE ? 0.42 : 0.55,
      transparent: true, opacity: 0.42, depthWrite: false, sizeAttenuation: true,
    }));
    this.spray.frustumCulled = false;
    this.sprayCount = sprayCount;
    this.sprayCursor = 0;
    scene.add(this.spray);

    this.lightning = new THREE.DirectionalLight(0xd9e8ff, 0);
    this.lightning.position.set(-25, 70, -40);
    scene.add(this.lightning);
  }

  setMode(mode) {
    this.mode = WEATHER_MODES.includes(mode) ? mode : 'auto';
    if (this.mode === 'clear') this.targetIntensity = 0;
    if (this.mode === 'storm') this.targetIntensity = 1;
    try { localStorage.setItem('turbo-weather-mode', this.mode); } catch { /* optional preference */ }
  }

  _autoTarget() {
    // A complete, cinematic weather arc every four minutes. Long plateaus stop
    // the scene from constantly changing while the player is concentrating.
    const phase = (this.autoTime % 240) / 240;
    if (phase < 0.12) return 0;
    if (phase < 0.27) return THREE.MathUtils.smoothstep((phase - 0.12) / 0.15, 0, 1) * 0.62;
    if (phase < 0.62) return 0.62 + Math.sin((phase - 0.27) * Math.PI / 0.35) * 0.38;
    if (phase < 0.82) return THREE.MathUtils.lerp(0.62, 0, THREE.MathUtils.smoothstep((phase - 0.62) / 0.2, 0, 1));
    return 0;
  }

  _updateRain(dt, exposed = true) {
    const dummy = new THREE.Object3D();
    const visible = Math.floor(this.rainCount * clamp01((this.intensity - 0.08) / 0.92));
    this.rain.visible = visible > 0 && exposed;
    this.rain.count = visible;
    this.rain.position.copy(this.camera.position);
    this.rain.position.y += 6;
    for (let i = 0; i < visible; i++) {
      const drop = this.rainDrops[i];
      drop.y -= drop.speed * dt;
      drop.x += this.wind.x * drop.speed * dt;
      if (drop.y < -7) {
        drop.y += 25;
        drop.x = (Math.random() - 0.5) * 42;
        drop.z = Math.random() * 54 - 36;
      }
      dummy.position.set(drop.x, drop.y, drop.z);
      dummy.rotation.set(0, 0, -0.085);
      dummy.scale.set(drop.scale, drop.scale, drop.scale);
      dummy.updateMatrix();
      this.rain.setMatrixAt(i, dummy.matrix);
    }
    if (visible > 0 && exposed) this.rain.instanceMatrix.needsUpdate = true;
  }

  _emitSpray(car) {
    if (car.speed < 12 || car.airborne || this.intensity < 0.25) return;
    const emitCount = IS_MOBILE ? 1 : 2;
    const origin = new THREE.Vector3();
    for (let n = 0; n < emitCount; n++) {
      const i = this.sprayCursor;
      this.sprayCursor = (this.sprayCursor + 1) % this.sprayCount;
      origin.set(n ? 0.72 : -0.72, 0.22, 1.72);
      car.group.localToWorld(origin);
      this.sprayPositions[i * 3] = origin.x;
      this.sprayPositions[i * 3 + 1] = origin.y;
      this.sprayPositions[i * 3 + 2] = origin.z;
      this.sprayVelocity[i * 3] = (Math.random() - 0.5) * 1.5;
      this.sprayVelocity[i * 3 + 1] = 0.5 + Math.random() * 1.1;
      this.sprayVelocity[i * 3 + 2] = 2.5 + Math.random() * 3.5;
      this.sprayLife[i] = 0.32 + Math.random() * 0.3;
    }
  }

  _updateSpray(dt, car, active) {
    if (active && Math.random() < dt * car.speed * this.intensity * (IS_MOBILE ? 0.65 : 1.25)) this._emitSpray(car);
    for (let i = 0; i < this.sprayCount; i++) {
      if (this.sprayLife[i] <= 0) continue;
      this.sprayLife[i] -= dt;
      this.sprayPositions[i * 3] += this.sprayVelocity[i * 3] * dt;
      this.sprayPositions[i * 3 + 1] += this.sprayVelocity[i * 3 + 1] * dt;
      this.sprayPositions[i * 3 + 2] += this.sprayVelocity[i * 3 + 2] * dt;
      this.sprayVelocity[i * 3 + 1] -= 2.4 * dt;
      if (this.sprayLife[i] <= 0) this.sprayPositions[i * 3 + 1] = -100;
    }
    this.spray.geometry.attributes.position.needsUpdate = true;
    this.spray.visible = this.intensity > 0.2;
  }

  _updateLightning(dt) {
    this.lightningTimer -= dt * (0.35 + this.intensity);
    if (this.intensity > 0.72 && this.lightningTimer <= 0) {
      this.lightningEnvelope = 1;
      this.lightningTimer = 7 + Math.random() * 15;
      this.thunderTimer = 0.9 + Math.random() * 2.4;
      document.getElementById('weather-flash')?.animate(
        [{ opacity: 0 }, { opacity: 0.62 }, { opacity: 0.08 }, { opacity: 0.36 }, { opacity: 0 }],
        { duration: 520, easing: 'ease-out' },
      );
    }
    this.lightningEnvelope = Math.max(0, this.lightningEnvelope - dt * 5.2);
    this.lightning.intensity = this.lightningEnvelope * 7.5;
    if (this.thunderTimer >= 0) {
      this.thunderTimer -= dt;
      if (this.thunderTimer < 0) this.audio.thunder(this.intensity);
    }
  }

  update(dt, car, active = true, sheltered = false) {
    if (this.mode === 'auto' && active) {
      this.autoTime += dt;
      this.targetIntensity = this._autoTarget();
    }
    const response = this.mode === 'auto'
      ? (this.targetIntensity > this.intensity ? 0.18 : 0.1)
      : 1.65;
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, dt * response);
    this.intensity = clamp01(this.intensity);
    this.applyWeather(this.intensity, this.lightningEnvelope);
    this.road.setWetness(this.intensity);
    this.audio.setWeather(this.intensity);
    this._updateRain(dt, !sheltered);
    this._updateSpray(dt, car, active);
    this._updateLightning(dt);
    return this.intensity;
  }
}
