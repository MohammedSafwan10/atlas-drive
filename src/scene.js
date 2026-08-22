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
  });
  let renderPixelRatio = Math.min(devicePixelRatio, GRAPHICS.maxPixelRatio);
  renderer.setPixelRatio(renderPixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !IS_MOBILE;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xb9cad6, 0.00235);

  const camera = new THREE.PerspectiveCamera(IS_MOBILE ? 58 : 64, innerWidth / innerHeight, 0.1, 1200);
  camera.position.set(0, IS_MOBILE ? 2.85 : 3.65, IS_MOBILE ? 5.2 : 7.2);

  // Use a sharp 6K photographic panorama for the visible sky/mountains, while
  // retaining the compact HDR file solely for image-based PBR lighting.
  const backdrop = new THREE.TextureLoader().load('/assets/alps_field_4k.webp');
  backdrop.mapping = THREE.EquirectangularReflectionMapping;
  backdrop.colorSpace = THREE.SRGBColorSpace;
  backdrop.minFilter = THREE.LinearMipmapLinearFilter;
  backdrop.magFilter = THREE.LinearFilter;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, GRAPHICS.skyWidthSegments, GRAPHICS.skyHeightSegments),
    new THREE.MeshBasicMaterial({
      map: backdrop,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  sky.rotation.y = Math.PI * 1.02;
  sky.renderOrder = -1000;
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

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }
  addEventListener('resize', resize);

  // Mobile GPUs vary enormously. Adjust drawing-buffer resolution slowly,
  // avoiding both prolonged low frame rates and distracting per-frame changes.
  let performanceTime = 0;
  let performanceFrames = 0;
  function updatePerformance(frameTime) {
    if (!IS_MOBILE || document.hidden) return;
    performanceTime += Math.min(frameTime, 0.1);
    performanceFrames += 1;
    if (performanceTime < 2.5) return;

    const fps = performanceFrames / performanceTime;
    let nextRatio = renderPixelRatio;
    if (fps < 42) nextRatio = Math.max(GRAPHICS.minPixelRatio, renderPixelRatio - 0.1);
    else if (fps > 57) nextRatio = Math.min(Math.min(devicePixelRatio, GRAPHICS.maxPixelRatio), renderPixelRatio + 0.1);

    if (nextRatio !== renderPixelRatio) {
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
    sun.position.set(chaseTarget.x + 48, 68, chaseTarget.z + 28);
    sun.target.position.set(chaseTarget.x, 0, chaseTarget.z);
  }

  return { renderer, scene, camera, update, updatePerformance };
}
