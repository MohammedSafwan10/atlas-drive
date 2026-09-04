import * as THREE from 'three';
import { roadCenterX } from './path.js';

// World-anchored mountain strips: real parallax, deterministic recycling and
// shared vertices at chunk boundaries. No panorama downloads or giant models.
const LENGTH = 400;
const WIDTH = [95, 135, 200, 290, 390, 510, 680, 900, 1200, 1600];
const smooth = (v) => v * v * (3 - 2 * v);
function hash(x, z) { const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return n - Math.floor(n); }
function noise(x, z) {
  const a = Math.floor(x), b = Math.floor(z), u = smooth(x - a), v = smooth(z - b);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(a,b), hash(a+1,b),u), THREE.MathUtils.lerp(hash(a,b+1),hash(a+1,b+1),u),v);
}
export function mountainHeight(distance, z, side) {
  const rise = THREE.MathUtils.smoothstep(distance, 95, 550);
  const ridge = 1 - Math.abs(noise(distance * 0.003 + side * 9, z * 0.002) * 2 - 1);
  return -5 + rise * (70 + ridge * 340 + noise(distance * 0.015, z * 0.012) * 55);
}
export class Landscape {
  constructor(scene) {
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, fog: true });
    // Mountains need atmospheric haze over kilometres; roadside fog is denser.
    this.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
        #ifdef USE_FOG
          float mountainFog = 1.0 - exp(-0.00000032 * vFogDepth * vFogDepth);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(mountainFog, 0.0, 0.94));
        #endif
      `);
    };
    this.chunks = [];
    for (let i = 0; i < 12; i++) {
      for (const side of [-1, 1]) {
        const geometry = new THREE.BufferGeometry();
        const count = WIDTH.length * 21;
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        const indices = [];
        for (let row = 0; row < 20; row++) for (let col = 0; col < WIDTH.length - 1; col++) {
          const a = row * WIDTH.length + col, b = a + WIDTH.length;
          if (side > 0) indices.push(a, a + 1, b, b, a + 1, b + 1);
          else indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
        geometry.setIndex(indices);
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.userData.side = side;
        scene.add(mesh);
        this.chunks.push(mesh);
      }
    }
    this.base = null;
    this.update(0);
  }
  rebuild(mesh, startZ) {
    const position = mesh.geometry.attributes.position, colors = mesh.geometry.attributes.color;
    const side = mesh.userData.side;
    const color = new THREE.Color();
    for (let row = 0; row <= 20; row++) for (let col = 0; col < WIDTH.length; col++) {
      const z = startZ - row * LENGTH / 20, d = WIDTH[col], h = mountainHeight(d, z, side);
      const i = row * WIDTH.length + col;
      position.setXYZ(i, roadCenterX(z) + side * d, h, z - startZ);
      const rock = THREE.MathUtils.smoothstep(h, 100, 260);
      color.set(0x354938).lerp(new THREE.Color(0x696d72), rock);
      const snow = THREE.MathUtils.smoothstep(h + noise(d * 0.03, z * 0.025) * 35, 305, 385);
      color.lerp(new THREE.Color(0xe2eaf0), snow);
      colors.setXYZ(i, color.r, color.g, color.b);
    }
    mesh.position.z = startZ;
    mesh.userData.startZ = startZ;
    position.needsUpdate = colors.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  }
  update(playerZ) {
    const base = Math.floor(playerZ / LENGTH) * LENGTH + LENGTH * 2;
    if (base === this.base) return;
    // Rebuild only the entering pair; all other chunks remain at world coordinates.
    const desired = Array.from({ length: 12 }, (_, i) => base - i * LENGTH);
    for (const side of [-1, 1]) {
      const meshes = this.chunks.filter(m => m.userData.side === side);
      const unused = meshes.filter(m => !desired.includes(m.userData.startZ));
      for (const z of desired) if (!meshes.some(m => m.userData.startZ === z)) this.rebuild(unused.pop(), z);
    }
    this.base = base;
  }
}
