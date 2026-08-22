// Nitro: triple exhaust flames + soft GPU particle jet, speed FOV kick
import * as THREE from 'three';
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
  float size = mix(0.08, 0.46, t) * (0.75 + 0.4 * fract(seed * 7.31));
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
  vec3 blue = vec3(0.42, 0.72, 1.0);
  vec3 col = mix(hot, blue, smoothstep(0.0, 0.55, t));
  float alpha = tex.a * vLife * 0.55 * mix(1.0, 0.08, smoothstep(0.35, 1.0, t));
  gl_FragColor = vec4(col * alpha, alpha);
}`;

const FLAME_VERT = `
varying float vAlong;
void main() {
  vAlong = position.y + 0.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FLAME_FRAG = `
uniform float uOpacity;
uniform vec3 uCore;
uniform vec3 uEdge;
varying float vAlong;
void main() {
  float baseFade = smoothstep(0.0, 0.12, vAlong);
  float tipFade = 1.0 - smoothstep(0.48, 1.0, vAlong);
  float alpha = baseFade * tipFade * uOpacity;
  vec3 color = mix(uCore, uEdge, smoothstep(0.08, 0.82, vAlong));
  gl_FragColor = vec4(color * alpha, alpha);
}`;

function makeFlameMaterial(core, edge, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: opacity },
      uCore: { value: new THREE.Color(core) },
      uEdge: { value: new THREE.Color(edge) },
    },
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

export class Effects {
  constructor(scene, camera, car) {
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

    // ---- Three restrained plumes, matching the Ferrari's centre exhausts ----
    const outerFlameMat = makeFlameMaterial(0xfff7df, 0x52a9ff, 0.46);
    const coreFlameMat = makeFlameMaterial(0xffffff, 0xc3e8ff, 0.64);
    this.flames = [];
    this.exhaustSockets = [-0.2, 0, 0.2];
    for (const lx of this.exhaustSockets) {
      const flame = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.072, 0.48, 14, 1, true), outerFlameMat.clone());
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.29, 12, 1, true), coreFlameMat.clone());
      outer.rotation.x = Math.PI / 2; // tip points backward along local +Z
      core.rotation.x = Math.PI / 2;
      outer.position.z = 0.22;
      core.position.z = 0.135;
      flame.add(outer, core);
      flame.position.set(lx, 0.31, 2.28);
      flame.visible = false;
      car.group.add(flame);
      flame.userData.outer = outer;
      flame.userData.core = core;
      this.flames.push(flame);
    }
    this.boostLight = new THREE.PointLight(0x2d8cff, 0, 4.5, 2.2);
    this.boostLight.position.set(0, 0.42, 2.55);
    car.group.add(this.boostLight);

    this.emitAccum = 0;
    this.exhaustWorld = new THREE.Vector3();
    this.exhaustVelocity = new THREE.Vector3();
  }

  emitNitro(car) {
    // One small burst from each of the three central pipes.
    for (const ex of this.exhaustSockets) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      this.exhaustWorld.set(ex, 0.31, 2.42);
      car.group.localToWorld(this.exhaustWorld);
      this.positions[i * 3] = this.exhaustWorld.x + (Math.random() - 0.5) * 0.06;
      this.positions[i * 3 + 1] = this.exhaustWorld.y + (Math.random() - 0.5) * 0.06;
      this.positions[i * 3 + 2] = this.exhaustWorld.z + (Math.random() - 0.5) * 0.06;
      this.exhaustVelocity.set((Math.random() - 0.5) * 0.35, 0.12 + Math.random() * 0.25, 4 + Math.random() * 2);
      this.exhaustVelocity.transformDirection(car.group.matrixWorld);
      this.vels[i * 3] = this.exhaustVelocity.x;
      this.vels[i * 3 + 1] = this.exhaustVelocity.y;
      this.vels[i * 3 + 2] = this.exhaustVelocity.z;
      this.lives[i] = 0.2 + Math.random() * 0.16;
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
    const flickerTime = performance.now() * 0.001;
    for (let f = 0; f < this.flames.length; f++) {
      const flame = this.flames[f];
      flame.visible = nitroActive && !crashed;
      if (flame.visible) {
        const flicker = 0.94 + Math.sin(flickerTime * 31 + f * 1.7) * 0.08;
        flame.scale.set(flicker, flicker, 0.92 + Math.sin(flickerTime * 24 + f) * 0.12);
        flame.userData.outer.material.uniforms.uOpacity.value = 0.4 + Math.sin(flickerTime * 27 + f) * 0.05;
      }
    }
    this.boostLight.intensity = nitroActive && !crashed ? 0.9 : 0;

    // Continuous emission while nitro is active (rate-based, not frame-based)
    if (nitroActive && !crashed) {
      this.emitAccum += dt * 55;
      while (this.emitAccum >= 1) {
        this.emitAccum -= 1;
        this.emitNitro(car);
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
