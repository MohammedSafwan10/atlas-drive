import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// Renderer, scene, camera, HDRI lighting, fog
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xb9cad6, 0.00235);

  const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 1200);
  camera.position.set(0, 4.2, 9);

  // Use a sharp 6K photographic panorama for the visible sky/mountains, while
  // retaining the compact HDR file solely for image-based PBR lighting.
  const backdrop = new THREE.TextureLoader().load('/assets/alps_field_4k.webp');
  backdrop.mapping = THREE.EquirectangularReflectionMapping;
  backdrop.colorSpace = THREE.SRGBColorSpace;
  backdrop.minFilter = THREE.LinearMipmapLinearFilter;
  backdrop.magFilter = THREE.LinearFilter;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 24),
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
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
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

  // Keep the sun shadow box centered on the action
  function update(chaseTarget) {
    sky.position.set(chaseTarget.x, 0, chaseTarget.z);
    sun.position.set(chaseTarget.x + 48, 68, chaseTarget.z + 28);
    sun.target.position.set(chaseTarget.x, 0, chaseTarget.z);
  }

  return { renderer, scene, camera, update };
}
