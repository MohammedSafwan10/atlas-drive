import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GRAPHICS, IS_MOBILE } from './platform.js';

// Renderer, scene, camera, HDRI lighting, fog
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    // Native 4x MSAA pushed the test phone into its 30 FPS compositor tier.
    // Mobile instead uses a denser drawing buffer, which preserves fine texture
    // detail with substantially lower bandwidth cost on tile-based GPUs.
    antialias: !IS_MOBILE,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  let renderPixelRatio = Math.min(devicePixelRatio, GRAPHICS.maxPixelRatio);
  renderer.setPixelRatio(renderPixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !IS_MOBILE;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xb9cad6, 0.00235);

  const camera = new THREE.PerspectiveCamera(IS_MOBILE ? 58 : 64, innerWidth / innerHeight, 0.1, 1200);
  camera.position.set(0, IS_MOBILE ? 2.85 : 3.65, IS_MOBILE ? 5.2 : 7.2);

  // Use a sharp 6K photographic panorama for the visible sky/mountains, while
  // retaining the compact HDR file solely for image-based PBR lighting.
  const textureLoader = new THREE.TextureLoader();
  const backdrops = [
    textureLoader.load('/assets/alps_field_4k.webp'),
    textureLoader.load('/assets/alps_field_sunset.webp'),
    textureLoader.load('/assets/alps_field_night.webp'),
    textureLoader.load('/assets/alps_field_storm.webp'),
  ];
  for (const backdrop of backdrops) {
    backdrop.mapping = THREE.EquirectangularReflectionMapping;
    backdrop.colorSpace = THREE.SRGBColorSpace;
    backdrop.minFilter = THREE.LinearMipmapLinearFilter;
    backdrop.magFilter = THREE.LinearFilter;
  }
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: backdrops[0] },
      sunsetMap: { value: backdrops[1] },
      nightMap: { value: backdrops[2] },
      stormMap: { value: backdrops[3] },
      timeWeights: { value: new THREE.Vector3(1, 0, 0) },
      weatherIntensity: { value: 0 },
    },
    vertexShader: `
      varying vec2 vSkyUv;
      void main() {
        vSkyUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D dayMap;
      uniform sampler2D sunsetMap;
      uniform sampler2D nightMap;
      uniform sampler2D stormMap;
      uniform vec3 timeWeights;
      uniform float weatherIntensity;
      varying vec2 vSkyUv;
      void main() {
        vec3 dayColor = timeWeights.x > 0.001 ? texture2D(dayMap, vSkyUv).rgb : vec3(0.0);
        vec3 sunsetColor = timeWeights.y > 0.001 ? texture2D(sunsetMap, vSkyUv).rgb : vec3(0.0);
        vec3 nightColor = timeWeights.z > 0.001 ? texture2D(nightMap, vSkyUv).rgb : vec3(0.0);
        float total = max(0.001, timeWeights.x + timeWeights.y + timeWeights.z);
        vec3 clearColor = (dayColor * timeWeights.x + sunsetColor * timeWeights.y + nightColor * timeWeights.z) / total;
        vec3 stormColor = weatherIntensity > 0.005 ? texture2D(stormMap, vSkyUv).rgb : vec3(0.0);
        gl_FragColor = vec4(mix(clearColor, stormColor, smoothstep(0.08, 0.9, weatherIntensity)), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, GRAPHICS.skyWidthSegments, GRAPHICS.skyHeightSegments),
    skyMaterial,
  );
  sky.rotation.y = Math.PI * 1.02;
  sky.renderOrder = 0;
  sky.frustumCulled = false;
  scene.add(sky);

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
  sun.castShadow = !IS_MOBILE;
  if (!IS_MOBILE) sun.shadow.mapSize.set(GRAPHICS.shadowMapSize, GRAPHICS.shadowMapSize);
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
  let lastMaterialRefresh = 0;
  let weatherIntensity = 0;
  let lightningIntensity = 0;
  let lastTimeProfile = null;
  function setTimeOfDay(profile) {
    lastTimeProfile = profile;
    skyMaterial.uniforms.timeWeights.value.fromArray(profile.weights);
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
    // strength to unique materials, throttled so transitions remain cheap and
    // late-loaded GLBs still inherit the current lighting within one second.
    const now = performance.now();
    if (Math.abs(profile.environmentIntensity - lastMaterialEnvironment) > 0.025 || now - lastMaterialRefresh > 1000) {
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
      lastMaterialRefresh = now;
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

  // Adjust drawing-buffer resolution smoothly to lock 60 FPS across all GPUs and laptops.
  let performanceTime = 0;
  let performanceFrames = 0;
  function updatePerformance(frameTime) {
    if (document.hidden) return;
    performanceTime += Math.min(frameTime, 0.1);
    performanceFrames += 1;
    if (performanceTime < 0.5) return;

    const fps = performanceFrames / performanceTime;
    let nextRatio = renderPixelRatio;
    if (fps < 48) {
      nextRatio = Math.max(GRAPHICS.minPixelRatio, renderPixelRatio - (fps < 30 ? 0.25 : 0.1));
    } else if (fps > 58 && renderPixelRatio < GRAPHICS.maxPixelRatio) {
      nextRatio = Math.min(GRAPHICS.maxPixelRatio, renderPixelRatio + 0.04);
    }

    if (Math.abs(nextRatio - renderPixelRatio) > 0.02) {
      renderPixelRatio = nextRatio;
      renderer.setPixelRatio(renderPixelRatio);
      renderer.setSize(innerWidth, innerHeight, false);
    }
    performanceTime = 0;
    performanceFrames = 0;
  }

  // Keep the sun shadow box centered on the action
  function update(chaseTarget) {
    sky.position.set(chaseTarget.x, 0, chaseTarget.z);
    sun.position.set(chaseTarget.x + sunDirection.x, sunDirection.y, chaseTarget.z + sunDirection.z);
    sun.target.position.set(chaseTarget.x, 0, chaseTarget.z);
  }

  return { renderer, scene, camera, update, updatePerformance, setTimeOfDay, setWeatherIntensity };
}
