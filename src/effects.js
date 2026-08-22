// Nitro: twin exhaust flames + soft GPU particle jet, speed FOV kick
import * as THREE from 'three';
import { roadPoint, roadYaw } from './path.js';
import { GRAPHICS, IS_MOBILE } from './platform.js';

function makeSparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const NITRO_VERT = `
attribute float life;
attribute float seed;
varying float vLife;
varying float vSeed;
void main() {
  vLife = life;
  vSeed = seed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float t = 1.0 - life;                 // 0 fresh -> 1 dead
  float size = mix(0.12, 1.1, t) * (0.7 + 0.6 * fract(seed * 7.31));
  gl_PointSize = size * (240.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const NITRO_FRAG = `
uniform sampler2D uMap;
varying float vLife;
varying float vSeed;
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  float t = 1.0 - vLife;
  // white-hot core -> blue flame -> faint smoke, fading out
  vec3 hot = vec3(0.85, 0.95, 1.0);
  vec3 blue = vec3(0.25, 0.55, 1.0);
  vec3 col = mix(hot, blue, smoothstep(0.0, 0.55, t));
  float alpha = tex.a * vLife * mix(1.0, 0.15, smoothstep(0.4, 1.0, t));
  gl_FragColor = vec4(col * alpha, alpha);
}`;

export class Effects {
  constructor(scene, camera) {
    this.camera = camera;
    this.baseFov = camera.fov;

    // ---- Nitro particle jet ----
    const count = GRAPHICS.particleCount;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 3);
    this.lives = new Float32Array(count);
    this.vels = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seeds[i] = Math.random();
      this.lives[i] = 0;
      this.positions[i * 3 + 1] = -100; // park offscreen
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('life', new THREE.BufferAttribute(this.lives, 1));
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: makeSparkTexture() } },
      vertexShader: NITRO_VERT,
      fragmentShader: NITRO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.count = count;
    this.cursor = 0;

    // ---- Twin exhaust flames (cone meshes, flicker each frame) ----
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x7db8ff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.flames = [];
    for (const lx of [-0.55, 0.55]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 10, 1, true), flameMat.clone());
      flame.rotation.x = -Math.PI / 2; // point backward (+z)
      flame.position.set(lx, 0.42, 2.5);
      flame.visible = false;
      scene.add(flame);
      this.flames.push(flame);
    }

    this.emitAccum = 0;
  }

  emitNitro(x, y, z) {
    // One burst = both exhausts
    for (const ex of [-0.55, 0.55]) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      this.positions[i * 3] = x + ex + (Math.random() - 0.5) * 0.08;
      this.positions[i * 3 + 1] = y + 0.42 + (Math.random() - 0.5) * 0.08;
      this.positions[i * 3 + 2] = z + 2.5;
      this.vels[i * 3] = (Math.random() - 0.5) * 1.2;
      this.vels[i * 3 + 1] = 0.4 + Math.random() * 0.8;
      this.vels[i * 3 + 2] = 6 + Math.random() * 4;
      this.lives[i] = 0.35 + Math.random() * 0.25;
    }
  }

  update(dt, car, nitroActive, crashed) {
    // Particle integration
    for (let i = 0; i < this.count; i++) {
      if (this.lives[i] > 0) {
        this.lives[i] -= dt * 2.2;
        if (this.lives[i] < 0) this.lives[i] = 0;
        this.positions[i * 3] += this.vels[i * 3] * dt;
        this.positions[i * 3 + 1] += this.vels[i * 3 + 1] * dt;
        this.positions[i * 3 + 2] += this.vels[i * 3 + 2] * dt;
        this.vels[i * 3 + 2] += 10 * dt; // accelerate away behind the car
      }
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.life.needsUpdate = true;
    this.points.material.uniforms && (this.points.visible = !crashed);
    this.points.visible = !crashed;

    // Exhaust flames: continuous emission + flicker while boosting
    for (let f = 0; f < this.flames.length; f++) {
      const flame = this.flames[f];
      flame.visible = nitroActive && !crashed;
      if (flame.visible) {
        roadPoint(car.z + 2.5, car.x + (f === 0 ? -0.55 : 0.55), 0.42, flame.position);
        flame.rotation.y = roadYaw(car.z);
        const flicker = 0.75 + Math.random() * 0.5;
        flame.scale.set(flicker, 0.8 + Math.random() * 0.7, flicker);
        flame.material.opacity = 0.55 + Math.random() * 0.35;
      }
    }

    // Continuous emission while nitro is active (rate-based, not frame-based)
    if (nitroActive && !crashed) {
      this.emitAccum += dt * 220;
      while (this.emitAccum >= 1) {
        this.emitAccum -= 1;
        this.emitNitro(car.group.position.x, car.group.position.y, car.group.position.z);
      }
    } else {
      this.emitAccum = 0;
    }

    // FOV kick with speed + nitro
    // A large FOV kick makes the player car look tiny on a phone. Keep just a
    // subtle sense of speed on mobile while preserving the desktop effect.
    const speedKick = IS_MOBILE ? 3 : 10;
    const nitroKick = IS_MOBILE ? 3 : 8;
    const targetFov = this.baseFov + (car.speed / 88) * speedKick + (nitroActive ? nitroKick : 0);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();
  }
}
