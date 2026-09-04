import * as THREE from 'three';
import { IS_MOBILE, GRAPHICS } from './platform.js';
import { roadPoint } from './path.js';

export const WEATHER_MODES = ['auto', 'clear', 'storm'];

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

function makeRainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: IS_MOBILE ? 0.56 : 0.66 },
    },
    vertexShader: `
      attribute float instanceSeed;
      varying vec2 vUv;
      varying float vSeed;
      varying float vDepth;
      void main() {
        vUv = uv;
        vSeed = instanceSeed;
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * world;
        float distanceToCamera = -mv.z;
        // Near-camera sheets are the main cause of "cartoon rain". Fade them
        // before they grow into broad white bars, then soften the far field.
        float nearFade = smoothstep(2.2, 7.5, distanceToCamera);
        float farFade = 1.0 - smoothstep(34.0, 58.0, distanceToCamera);
        vDepth = nearFade * farFade;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vSeed;
      varying float vDepth;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float across = abs(vUv.x * 2.0 - 1.0);
        float filament = pow(max(0.0, 1.0 - across), 9.0);
        float softEdge = pow(max(0.0, 1.0 - across), 2.2) * 0.055;
        float ends = smoothstep(0.0, 0.16, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));
        // Oscillating drops produce several uneven highlights inside a
        // motion-blurred streak instead of one uniformly lit rectangle.
        float speckle = 0.58 + 0.42 * sin(vUv.y * (19.0 + vSeed * 17.0) + vSeed * 31.0);
        speckle = mix(0.87, 1.0, speckle * speckle);
        float alpha = (filament * speckle + softEdge) * ends * vDepth * uOpacity;
        if (alpha < 0.008) discard;
        vec3 color = mix(vec3(0.52, 0.67, 0.82), vec3(0.9, 0.96, 1.0), filament * 0.68 + hash(vSeed) * 0.08);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
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
    this.boltAge = Number.POSITIVE_INFINITY;
    this.thunderTimer = -1;
    this.wind = new THREE.Vector3(0.16, 0, 0.04);
    this.matrixDummy = new THREE.Object3D();
    this.sprayOrigin = new THREE.Vector3();
    this.boltDirection = new THREE.Vector3();
    this.boltMidpoint = new THREE.Vector3();
    this.boltScale = new THREE.Vector3();
    this.boltQuaternion = new THREE.Quaternion();
    this.boltMatrix = new THREE.Matrix4();
    this.boltUp = new THREE.Vector3(0, 1, 0);

    this.rainCount = GRAPHICS.rainCount;
    const geometry = new THREE.PlaneGeometry(IS_MOBILE ? 0.036 : 0.045, IS_MOBILE ? 0.92 : 1.28);
    const seeds = new Float32Array(this.rainCount);
    for (let i = 0; i < this.rainCount; i++) seeds[i] = Math.random();
    geometry.setAttribute('instanceSeed', new THREE.InstancedBufferAttribute(seeds, 1));
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
        speed: 23 + Math.random() * 20,
        width: 0.55 + Math.random() * 0.65,
        length: 0.55 + Math.random() * 0.9,
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

    // Tiny expanding rings provide the ground-contact cue that falling streaks
    // alone cannot. They share one draw call and vanish inside tunnels.
    this.splashCount = IS_MOBILE ? 24 : 64;
    const splashGeometry = new THREE.RingGeometry(0.045, 0.075, 10);
    splashGeometry.rotateX(-Math.PI / 2);
    this.splashes = new THREE.InstancedMesh(
      splashGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xb9d4e3, transparent: true, opacity: IS_MOBILE ? 0.12 : 0.16,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      }),
      this.splashCount,
    );
    this.splashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splashes.frustumCulled = false;
    this.splashDrops = Array.from({ length: this.splashCount }, () => ({ life: 0, maxLife: 0.35, point: new THREE.Vector3() }));
    this.splashCursor = 0;
    this.splashAccum = 0;
    scene.add(this.splashes);

    this.lightning = new THREE.DirectionalLight(0xd9e8ff, 0);
    this.lightning.position.set(-25, 70, -40);
    scene.add(this.lightning);

    // A strike used to allocate dozens of cylinder geometries and materials at
    // the exact moment it appeared. Keep one GPU-resident cylinder and instance
    // it for the core and glow so a strike only updates matrices.
    this.maxBoltSegments = IS_MOBILE ? 36 : 64;
    const boltGeometry = new THREE.CylinderGeometry(1, 0.72, 1, 5, 1);
    this.boltCoreMaterial = new THREE.MeshBasicMaterial({
      color: 0xeaf4ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    });
    this.boltGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0x8cbcff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    });
    this.boltCore = new THREE.InstancedMesh(boltGeometry, this.boltCoreMaterial, this.maxBoltSegments);
    this.boltGlow = new THREE.InstancedMesh(boltGeometry, this.boltGlowMaterial, this.maxBoltSegments);
    this.boltCore.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.boltGlow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.boltCore.frustumCulled = false;
    this.boltGlow.frustumCulled = false;
    this.boltCore.count = 0;
    this.boltGlow.count = 0;
    this.boltGroup = new THREE.Group();
    this.boltGroup.visible = false;
    this.boltGroup.add(this.boltGlow, this.boltCore);
    scene.add(this.boltGroup);
  }

  setMode(mode) {
    this.mode = WEATHER_MODES.includes(mode) ? mode : 'auto';
    if (this.mode === 'clear') this.targetIntensity = 0;
    if (this.mode === 'storm') {
      this.targetIntensity = 1;
      // Give a manually selected storm one early cinematic strike; later
      // lightning remains irregular and cannot be predicted by the player.
      this.lightningTimer = Math.min(this.lightningTimer, 2.8 + Math.random() * 2.2);
    }
    try { localStorage.setItem('atlas-drive-weather-mode', this.mode); } catch { /* optional preference */ }
  }

  forceLightning(delay = 1.8) {
    this.intensity = 1;
    this.targetIntensity = 1;
    this.lightningTimer = Math.max(0, delay);
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
    const dummy = this.matrixDummy;
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
      dummy.scale.set(drop.width, drop.length, 1);
      dummy.updateMatrix();
      this.rain.setMatrixAt(i, dummy.matrix);
    }
    if (visible > 0 && exposed) this.rain.instanceMatrix.needsUpdate = true;
  }

  _emitGroundSplash(car) {
    const splash = this.splashDrops[this.splashCursor];
    this.splashCursor = (this.splashCursor + 1) % this.splashCount;
    const lateral = (Math.random() - 0.5) * 11.4;
    const z = car.z + 7 - Math.random() * 31;
    roadPoint(z, lateral, 0.055, splash.point);
    splash.life = 0.22 + Math.random() * 0.18;
    splash.maxLife = splash.life;
  }

  _updateGroundSplashes(dt, car, exposed) {
    const dummy = this.matrixDummy;
    if (exposed && this.intensity > 0.22) {
      this.splashAccum += dt * (IS_MOBILE ? 9 : 23) * this.intensity;
      while (this.splashAccum >= 1) {
        this.splashAccum -= 1;
        this._emitGroundSplash(car);
      }
    }
    let visible = 0;
    for (const splash of this.splashDrops) {
      if (splash.life <= 0) continue;
      splash.life -= dt;
      if (splash.life <= 0) continue;
      const progress = 1 - splash.life / splash.maxLife;
      const scale = 0.45 + progress * 2.7;
      dummy.position.copy(splash.point);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      this.splashes.setMatrixAt(visible++, dummy.matrix);
    }
    this.splashes.count = visible;
    this.splashes.visible = exposed && visible > 0;
    if (visible > 0) this.splashes.instanceMatrix.needsUpdate = true;
  }

  _emitSpray(car) {
    if (car.speed < 12 || car.airborne || this.intensity < 0.25) return;
    const emitCount = IS_MOBILE ? 1 : 2;
    const origin = this.sprayOrigin;
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

  _setBoltInstance(mesh, index, a, b, radius) {
    this.boltDirection.subVectors(b, a);
    const length = this.boltDirection.length();
    this.boltMidpoint.copy(a).add(b).multiplyScalar(0.5);
    this.boltQuaternion.setFromUnitVectors(this.boltUp, this.boltDirection.normalize());
    this.boltScale.set(radius, length, radius);
    this.boltMatrix.compose(this.boltMidpoint, this.boltQuaternion, this.boltScale);
    mesh.setMatrixAt(index, this.boltMatrix);
  }

  _spawnLightningBolt() {
    let coreCount = 0;
    let glowCount = 0;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const side = new THREE.Vector3(-forward.z, 0, forward.x);
    const origin = this.camera.position.clone()
      .addScaledVector(forward, 88 + Math.random() * 48)
      .addScaledVector(side, (Math.random() - 0.5) * 82);
    origin.y += 56 + Math.random() * 24;

    const points = [origin.clone()];
    const segments = IS_MOBILE ? 11 : 15;
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      points.push(new THREE.Vector3(
        origin.x + (Math.random() - 0.5) * (3.8 + t * 6.5),
        THREE.MathUtils.lerp(origin.y, 10 + Math.random() * 7, t),
        origin.z + (Math.random() - 0.5) * (2.4 + t * 4.5),
      ));
    }
    for (let i = 1; i < points.length; i++) {
      if (coreCount < this.maxBoltSegments) {
        this._setBoltInstance(this.boltCore, coreCount++, points[i - 1], points[i], IS_MOBILE ? 0.065 : 0.08);
      }
      if (!IS_MOBILE && glowCount < this.maxBoltSegments) {
        this._setBoltInstance(this.boltGlow, glowCount++, points[i - 1], points[i], 0.34);
      }
      if (i > 2 && i < points.length - 3 && Math.random() < 0.26) {
        let branchStart = points[i].clone();
        const branchSegments = 3 + Math.floor(Math.random() * 3);
        for (let j = 0; j < branchSegments; j++) {
          const branchEnd = branchStart.clone().add(new THREE.Vector3(
            (Math.random() < 0.5 ? -1 : 1) * (2.2 + Math.random() * 4.5),
            -(3 + Math.random() * 5),
            (Math.random() - 0.5) * 4,
          ));
          if (coreCount < this.maxBoltSegments) {
            this._setBoltInstance(this.boltCore, coreCount++, branchStart, branchEnd, IS_MOBILE ? 0.025 : 0.038);
          }
          branchStart = branchEnd;
        }
      }
    }
    this.boltCore.count = coreCount;
    this.boltGlow.count = glowCount;
    this.boltCore.instanceMatrix.needsUpdate = true;
    this.boltGlow.instanceMatrix.needsUpdate = true;
    this.boltGroup.visible = true;
  }

  warmUp(renderer, scene, camera) {
    const timer = this.lightningTimer;
    this._spawnLightningBolt();
    this.boltCoreMaterial.opacity = 1;
    this.boltGlowMaterial.opacity = 0.16;
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    this.boltGroup.visible = false;
    this.boltAge = Number.POSITIVE_INFINITY;
    this.lightningEnvelope = 0;
    this.lightning.intensity = 0;
    this.lightningTimer = timer;
  }

  _updateLightning(dt) {
    this.lightningTimer -= dt * (0.35 + this.intensity);
    if (this.intensity > 0.72 && this.lightningTimer <= 0) {
      this.boltAge = 0;
      this._spawnLightningBolt();
      this.lightningTimer = 7 + Math.random() * 15;
      this.thunderTimer = 0.9 + Math.random() * 2.4;
      document.getElementById('weather-flash')?.animate(
        [{ opacity: 0 }, { opacity: 0.62 }, { opacity: 0.08 }, { opacity: 0.36 }, { opacity: 0 }],
        { duration: 520, easing: 'ease-out' },
      );
    }
    this.boltAge += dt;
    if (this.boltAge < 0.075) this.lightningEnvelope = 1;
    else if (this.boltAge < 0.14) this.lightningEnvelope = 0.12;
    else if (this.boltAge < 0.24) this.lightningEnvelope = 0.62;
    else this.lightningEnvelope = Math.max(0, 0.45 - (this.boltAge - 0.24) * 3.6);
    this.boltGroup.visible = this.lightningEnvelope > 0.025;
    const boltOpacity = Math.min(1, this.lightningEnvelope * 1.5);
    this.boltCoreMaterial.opacity = boltOpacity;
    this.boltGlowMaterial.opacity = 0.16 * boltOpacity;
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
    this.road.setWetness(this.intensity);
    this.audio.setWeather(this.intensity);
    this._updateRain(dt, !sheltered);
    this._updateGroundSplashes(dt, car, !sheltered);
    this._updateSpray(dt, car, active);
    this._updateLightning(dt);
    // Lightning updates after the weather profile so the new flash would be a
    // frame late without this lightweight second application.
    this.applyWeather(this.intensity, this.lightningEnvelope);
    return this.intensity;
  }
}
