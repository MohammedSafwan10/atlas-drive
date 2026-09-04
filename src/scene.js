import * as THREE from 'three';
import { Landscape } from './landscape.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GRAPHICS, IS_MOBILE, QUALITY } from './platform.js';

// Renderer, scene, camera, HDRI lighting, fog
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    // Native 4x MSAA pushed the test phone into its 30 FPS compositor tier.
    // Mobile instead uses a denser drawing buffer, which preserves fine texture
    // detail with substantially lower bandwidth cost on tile-based GPUs.
    antialias: GRAPHICS.shadowMapSize > 0,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  let renderPixelRatio = Math.min(devicePixelRatio, GRAPHICS.maxPixelRatio);
  renderer.setPixelRatio(renderPixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = GRAPHICS.shadowMapSize > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xb9cad6, 0.00235);

  const camera = new THREE.PerspectiveCamera(IS_MOBILE ? 58 : 64, innerWidth / innerHeight, 0.1, 4200);
  camera.position.set(0, IS_MOBILE ? 2.85 : 3.65, IS_MOBILE ? 5.2 : 7.2);

  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: new THREE.Color(0xb9cad6) },
      zenith: { value: new THREE.Color(0x2765a0) },
      sunColor: { value: new THREE.Color(0xffefcf) },
      sunDirection: { value: new THREE.Vector3(0.4, 0.8, -0.3).normalize() },
      night: { value: 0 }, weatherIntensity: { value: 0 }, time: { value: 0 },
    },
    vertexShader: `varying vec3 vDirection;
      void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vDirection;
      uniform vec3 horizon, zenith, sunColor, sunDirection;
      uniform float night, weatherIntensity, time;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }
      void main() {
        vec3 d = normalize(vDirection);
        float h = max(d.y,0.0);
        vec3 color = mix(horizon,zenith,pow(h,0.48));
        float sun = max(dot(d,normalize(sunDirection)),0.0);
        color += sunColor * (pow(sun,1000.0)*2.0 + pow(sun,18.0)*0.18) * (1.0-weatherIntensity) * (1.0-night);
        vec2 uv = d.xz / max(0.12,d.y + 0.22) * 2.0 + vec2(time*0.006,0);
        float n = noise(uv)*0.58 + noise(uv*2.1)*0.28 + noise(uv*4.3)*0.14;
        float cloud = smoothstep(mix(0.57,0.31,weatherIntensity),0.79,n) * smoothstep(0.0,0.12,d.y);
        vec3 cloudColor = mix(mix(vec3(0.91,0.94,0.97),horizon,0.28),vec3(0.16,0.20,0.25),weatherIntensity);
        cloudColor *= 1.0-night*0.72;
        color = mix(color,cloudColor,cloud*0.92);
        vec2 stars = vec2(atan(d.z,d.x),asin(d.y))*500.0;
        float star = step(0.997,hash(floor(stars))) * pow(1.0-length(fract(stars)-0.5),8.0);
        color += star * night * (1.0-weatherIntensity) * (1.0-cloud) * smoothstep(0.02,0.3,d.y);
        gl_FragColor = vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3900, 32, 16), skyMaterial);
  sky.frustumCulled = false;
  scene.add(sky);
  const landscape = new Landscape(scene);

  // The HDRI drives reflections and ambient illumination but is not displayed.
  const pmrem = new THREE.PMREMGenerator(renderer);
  new RGBELoader().load('/assets/sky_1k.hdr', (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    pmrem.dispose();
  });

  // Lighting: HDRI provides ambient/reflections; sun adds direction + shadows
  const hemi = new THREE.HemisphereLight(0xbdd4ea, 0x424b37, 0.25);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d5, 2.2);
  sun.position.set(48, 68, 28);
  sun.castShadow = GRAPHICS.shadowMapSize > 0;
  if (GRAPHICS.shadowMapSize) sun.shadow.mapSize.set(GRAPHICS.shadowMapSize, GRAPHICS.shadowMapSize);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -48;
  sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 48;
  sun.shadow.camera.bottom = -48;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);

  const sunDirection = new THREE.Vector3(48, 68, 28);
  let lastMaterialEnvironment = 1;
  let weatherIntensity = 0;
  let lightningIntensity = 0;
  let lastTimeProfile = null;
  function setTimeOfDay(profile, forceMaterialRefresh = false) {
    lastTimeProfile = profile;
    skyMaterial.uniforms.horizon.value.copy(profile.fogColor).lerp(new THREE.Color(0x4d6071), weatherIntensity * 0.7);
    skyMaterial.uniforms.zenith.value.copy(profile.skyColor).multiplyScalar(0.48).lerp(new THREE.Color(0x192733), weatherIntensity * 0.7);
    skyMaterial.uniforms.sunColor.value.copy(profile.sunColor);
    skyMaterial.uniforms.sunDirection.value.copy(profile.sunDirection).normalize();
    skyMaterial.uniforms.night.value = profile.night;
    renderer.toneMappingExposure = profile.exposure * THREE.MathUtils.lerp(1, 0.73, weatherIntensity) + lightningIntensity * 0.16;
    scene.fog.color.copy(profile.fogColor).lerp(new THREE.Color(0x74828e), weatherIntensity * 0.72);
    scene.fog.density = profile.fogDensity + weatherIntensity * 0.00155;
    hemi.color.copy(profile.skyColor).lerp(new THREE.Color(0x718397), weatherIntensity * 0.7);
    hemi.groundColor.copy(profile.groundColor).lerp(new THREE.Color(0x293330), weatherIntensity * 0.6);
    hemi.intensity = profile.hemiIntensity * THREE.MathUtils.lerp(1, 0.68, weatherIntensity) + lightningIntensity * 0.45;
    sun.color.copy(profile.sunColor);
    sun.intensity = profile.sunIntensity * THREE.MathUtils.lerp(1, 0.2, weatherIntensity) + lightningIntensity * 1.2;
    sunDirection.copy(profile.sunDirection);
    // Three r160 has no scene.environmentIntensity. Apply the time-of-day HDR
    // strength to unique materials. Late-loaded assets are explicitly refreshed
    // once behind the loading gate, avoiding a scene-wide traversal every second.
    if (forceMaterialRefresh || Math.abs(profile.environmentIntensity - lastMaterialEnvironment) > 0.025) {
      const materials = new Set();
      scene.traverse((object) => {
        if (!object.isMesh || !object.material) return;
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) materials.add(material);
      });
      for (const material of materials) {
        if (!('envMapIntensity' in material)) continue;
        if (material.userData.timeBaseEnvIntensity === undefined) {
          material.userData.timeBaseEnvIntensity = material.envMapIntensity;
        }
        material.envMapIntensity = material.userData.timeBaseEnvIntensity * profile.environmentIntensity;
      }
      lastMaterialEnvironment = profile.environmentIntensity;
    }
  }

  function setWeatherIntensity(intensity, lightning = 0) {
    weatherIntensity = THREE.MathUtils.clamp(intensity, 0, 1);
    lightningIntensity = THREE.MathUtils.clamp(lightning, 0, 1);
    skyMaterial.uniforms.weatherIntensity.value = weatherIntensity;
    if (lastTimeProfile) setTimeOfDay(lastTimeProfile);
  }

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }
  addEventListener('resize', resize);

  // Keep the renderer at the selected quality from boot. Reallocating the
  // drawing buffer mid-race creates visible hitches and silently changes image quality.
  let sampleTime = 0, sampleFrames = 0, cooldown = 6;
  function updatePerformance(frameTime) {
    if (QUALITY !== 'auto' || frameTime > 0.15 || frameTime <= 0) return;
    cooldown -= frameTime;
    sampleTime += frameTime; sampleFrames++;
    if (sampleTime < 3) return;
    const fps = sampleFrames / sampleTime;
    if (cooldown <= 0) {
      const target = fps < 45 ? Math.max(GRAPHICS.minPixelRatio, renderPixelRatio - 0.1)
        : fps > 58 ? Math.min(Math.min(devicePixelRatio, GRAPHICS.maxPixelRatio), renderPixelRatio + 0.05) : renderPixelRatio;
      if (Math.abs(target - renderPixelRatio) > 0.01) {
        renderPixelRatio = target;
        renderer.setPixelRatio(target);
        cooldown = 8;
      }
    }
    sampleTime = sampleFrames = 0;
  }

  // Keep the sun shadow box centered on the action
  function update(chaseTarget, dt = 0) {
    landscape.update(chaseTarget.z);
    skyMaterial.uniforms.time.value += dt;
    sky.position.copy(chaseTarget);
    sun.position.set(chaseTarget.x + sunDirection.x, sunDirection.y, chaseTarget.z + sunDirection.z);
    sun.target.position.set(chaseTarget.x, 0, chaseTarget.z);
  }

  return { renderer, scene, camera, update, updatePerformance, setTimeOfDay, setWeatherIntensity };
}
