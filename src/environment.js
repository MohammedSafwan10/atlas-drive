import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roadCenterX, roadElevation, roadPoint } from './path.js';
import { GRAPHICS, IS_MOBILE, scaledCount } from './platform.js';

// Photoreal environment assets. The GLBs are web-optimized 1K PBR versions of
// Poly Haven CC0 scans; the trees use high-resolution alpha cutouts on crossed
// cards so a large forest remains practical in a browser.
const ASSETS = '/assets/realistic/';
const MODEL_URLS = {
  boulder: `${ASSETS}boulder.glb`,
  rock: `${ASSETS}rock.glb`,
  fern: `${ASSETS}fern.glb`,
  grass: `${ASSETS}grass/grass_bermuda_01_1k.gltf`,
  pineTree: `${ASSETS}trees/pine.glb`,
  islandTree: `${ASSETS}trees/island.glb`,
  jacarandaTree: `${ASSETS}trees/jacaranda.glb`,
};

const TERRAIN_WIDTH = 600;
const TERRAIN_LENGTH = 1200;
const TERRAIN_Z_SEGMENTS = GRAPHICS.terrainSegments;
const TERRAIN_X_COORDS = [
  -300, -220, -160, -115, -82, -58, -42, -31, -23, -18, -16, -14.5, -13,
  -11.5, -10, -8.5, -7, -6.6, 0, 6.6, 7, 8.5, 10, 11.5, 13, 14.5, 16,
  18, 23, 31, 42, 58, 82, 115, 160, 220, 300,
];

function smoothstep(min, max, value) {
  const t = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

// World-space terrain profile: level under the road, gravel shoulder, a shallow
// drainage trough, then rising irregular countryside. Deterministic world-space
// waves ensure recycled terrain and scenery always meet at the same height.
function terrainHeightAt(x, z) {
  const distance = Math.abs(x - roadCenterX(z));
  const base = roadElevation(z);
  if (distance <= 6.8) return base - 0.12;

  const broad = Math.sin(z * 0.017 + x * 0.041) * 0.78;
  const cross = Math.sin(z * 0.031 - x * 0.067) * 0.42;
  const detail = Math.sin(z * 0.083 + x * 0.119) * 0.14;
  const outerHeight = base + 1.45 + broad + cross + detail + Math.min((distance - 16) * 0.0045, 1.25);

  if (distance <= 8.8) {
    return THREE.MathUtils.lerp(base - 0.12, base - 0.34, smoothstep(6.8, 8.8, distance));
  }
  if (distance <= 11.5) {
    return THREE.MathUtils.lerp(base - 0.34, base - 1.18, smoothstep(8.8, 11.5, distance));
  }
  if (distance <= 16) {
    return THREE.MathUtils.lerp(base - 1.18, outerHeight, smoothstep(11.5, 16, distance));
  }
  return outerHeight;
}

function stripJitter(x, worldZ, amount) {
  if (!amount) return x;
  const wave = (Math.sin(worldZ * 0.115 + 0.8) + Math.sin(worldZ * 0.039 - 1.7) * 0.55) / 1.55;
  return x + Math.sign(x || 1) * wave * amount;
}

function makeTerrainGeometry(xCoords, length, zSegments, centerZ, lift = 0, edgeJitter = 0) {
  const columns = xCoords.length;
  const rows = zSegments + 1;
  const positions = new Float32Array(columns * rows * 3);
  const uvs = new Float32Array(columns * rows * 2);
  const indices = [];

  let p = 0;
  let uv = 0;
  for (let row = 0; row < rows; row++) {
    const localZ = length / 2 - (row / zSegments) * length;
    for (const baseX of xCoords) {
      const worldZ = localZ + centerZ;
      const lateral = stripJitter(baseX, worldZ, edgeJitter);
      const x = roadCenterX(worldZ) + lateral;
      positions[p++] = x;
      positions[p++] = terrainHeightAt(x, localZ + centerZ) + lift;
      positions[p++] = localZ;
      uvs[uv++] = (baseX + TERRAIN_WIDTH / 2) / TERRAIN_WIDTH;
      uvs[uv++] = row / zSegments;
    }
  }

  for (let row = 0; row < zSegments; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column;
      const b = a + columns;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.terrain = { xCoords, length, zSegments, lift, edgeJitter };
  return geometry;
}

function updateTerrainGeometry(geometry, centerZ) {
  const { xCoords, length, zSegments, lift, edgeJitter } = geometry.userData.terrain;
  const positions = geometry.getAttribute('position');
  const columns = xCoords.length;
  let index = 0;
  for (let row = 0; row <= zSegments; row++) {
    const localZ = length / 2 - (row / zSegments) * length;
    for (const baseX of xCoords) {
      const worldZ = localZ + centerZ;
      const lateral = stripJitter(baseX, worldZ, edgeJitter);
      const x = roadCenterX(worldZ) + lateral;
      positions.setX(index, x);
      positions.setY(index++, terrainHeightAt(x, localZ + centerZ) + lift);
    }
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
}

function loadTerrainSet(loader, name, repeat, anisotropy) {
  const base = `/assets/terrain/${name}`;
  const diffuse = loader.load(`${base}_diff.jpg`);
  const normal = loader.load(`${base}_nor.jpg`);
  const roughness = loader.load(`${base}_rough.jpg`);
  for (const texture of [diffuse, normal, roughness]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.copy(repeat);
    texture.anisotropy = anisotropy;
  }
  diffuse.colorSpace = THREE.SRGBColorSpace;
  return { diffuse, normal, roughness, textures: [diffuse, normal, roughness] };
}

function loadModel(loader, url) {
  return new Promise((resolve) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, () => resolve(null));
  });
}

function normalize(proto, targetHeight) {
  const box = new THREE.Box3().setFromObject(proto);
  const size = box.getSize(new THREE.Vector3());
  const scale = targetHeight / Math.max(size.y, 0.001);
  const wrapper = new THREE.Group();
  proto.position.set(-(box.min.x + size.x / 2), -box.min.y, -(box.min.z + size.z / 2));
  wrapper.add(proto);
  wrapper.scale.setScalar(scale);
  return wrapper;
}

// Poly Haven's grass asset is split into many tiny meshes. Merging them once
// turns every placed tuft from 21 draw calls into one without changing detail.
function mergeStaticModel(root) {
  root.updateMatrixWorld(true);
  const geometries = [];
  let material = null;
  root.traverse((object) => {
    if (!object.isMesh || object.isSkinnedMesh) return;
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    geometries.push(geometry);
    material ||= Array.isArray(object.material) ? object.material[0] : object.material;
  });
  const merged = geometries.length ? mergeGeometries(geometries, false) : null;
  geometries.forEach((geometry) => geometry.dispose());
  return merged && material ? new THREE.Mesh(merged, material) : root;
}

function configurePBR(root, { shadows = true, foliage = false } = {}) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = shadows;
    object.receiveShadow = shadows;
    if (!object.material) return;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.metalness = 0;
      material.roughness = Math.max(material.roughness ?? 0.8, 0.72);
      if (foliage || material.alphaTest > 0) {
        material.side = THREE.DoubleSide;
        material.alphaTest = Math.max(material.alphaTest || 0, 0.35);
        material.transparent = false;
      }
      material.needsUpdate = true;
    }
  });
}

function makeTreeCard(texture, widthRatio = 2 / 3) {
  const geometry = new THREE.PlaneGeometry(widthRatio, 1);
  geometry.translate(0, 0.5, 0);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.32,
    transparent: false,
    side: THREE.DoubleSide,
    roughness: 0.92,
    metalness: 0,
  });

  const tree = new THREE.Group();
  const front = new THREE.Mesh(geometry, material);
  const side = new THREE.Mesh(geometry, material);
  side.rotation.y = Math.PI / 2;
  front.castShadow = side.castShadow = true;
  tree.add(front, side);
  return tree;
}

export class Environment {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    const maxAnisotropy = GRAPHICS.anisotropy;
    const texLoader = new THREE.TextureLoader();
    // Each scan covers roughly four world metres. All three materials share the
    // same world-space texel scale, so the border never stretches or swims.
    this.terrainRepeat = new THREE.Vector2(150, 300);
    const forest = loadTerrainSet(texLoader, 'forest', this.terrainRepeat, maxAnisotropy);
    const gravel = loadTerrainSet(texLoader, 'gravel', this.terrainRepeat, maxAnisotropy);
    const dirt = loadTerrainSet(texLoader, 'dirt', this.terrainRepeat, maxAnisotropy);
    this.terrainTextures = [...forest.textures, ...gravel.textures, ...dirt.textures];

    const groundMat = new THREE.MeshStandardMaterial({
      map: forest.diffuse,
      ...(!IS_MOBILE && { normalMap: forest.normal, roughnessMap: forest.roughness }),
      color: 0x91a979,
      normalScale: new THREE.Vector2(1.25, 1.25),
      roughness: 1,
      metalness: 0,
    });
    this.terrainCenterZ = -300;
    this.ground = new THREE.Mesh(
      makeTerrainGeometry(TERRAIN_X_COORDS, TERRAIN_LENGTH, TERRAIN_Z_SEGMENTS, this.terrainCenterZ),
      groundMat,
    );
    this.ground.position.z = this.terrainCenterZ;
    this.ground.receiveShadow = true;
    this.group.add(this.ground);

    // Independent scanned materials follow the 3D shoulder and ditch profile.
    const shoulderMat = new THREE.MeshStandardMaterial({
      map: gravel.diffuse,
      ...(!IS_MOBILE && { normalMap: gravel.normal, roughnessMap: gravel.roughness }),
      normalScale: new THREE.Vector2(1.35, 1.35),
      roughness: 1,
      metalness: 0,
    });
    const ditchMat = new THREE.MeshStandardMaterial({
      map: dirt.diffuse,
      ...(!IS_MOBILE && { normalMap: dirt.normal, roughnessMap: dirt.roughness }),
      normalScale: new THREE.Vector2(1.5, 1.5),
      roughness: 1,
      metalness: 0,
    });
    const strips = [
      { xCoords: [6.65, 7.2, 8.8], material: shoulderMat, edgeJitter: 0.16 },
      { xCoords: [8.8, 10, 11.5, 12.5, 13.5], material: ditchMat, edgeJitter: 0.48 },
    ];
    this.shoulders = strips.flatMap(({ xCoords, material, edgeJitter }) => {
      const sides = [xCoords.map((x) => -x).reverse(), xCoords];
      return sides.map((sideCoords) => {
      const shoulder = new THREE.Mesh(
          makeTerrainGeometry(
            sideCoords,
            TERRAIN_LENGTH,
            TERRAIN_Z_SEGMENTS,
            this.terrainCenterZ,
            0.025,
            edgeJitter,
          ),
          material,
      );
      shoulder.position.z = this.terrainCenterZ;
      shoulder.receiveShadow = true;
      this.group.add(shoulder);
      return shoulder;
      });
    });
    this.terrainMeshes = [this.ground, ...this.shoulders];

    const loader = new GLTFLoader();

    this.trees = [];
    this.props = [];
    this.instancedPools = [];

    const pineTexture = texLoader.load(`${ASSETS}pine_tree.png`);
    const broadleafTexture = texLoader.load(`${ASSETS}broadleaf_tree.png`);
    for (const texture of [pineTexture, broadleafTexture]) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = maxAnisotropy;
    }

    const treePrototypes = [makeTreeCard(pineTexture), makeTreeCard(broadleafTexture)];
    const makePool = (prototypes, count, heightMin, heightMax, minDist, maxDist) => {
      if (!prototypes.length) return [];
      const normalized = prototypes.map((prototype, index) => {
        const height = heightMin + ((index * 0.6180339887 + 0.27) % 1) * (heightMax - heightMin);
        return normalize(prototype, height);
      });
      const pool = [];
      for (let i = 0; i < count; i++) {
        const object = normalized[i % normalized.length].clone(true);
        object.userData.recycleRange = [minDist, maxDist];
        this._placeScenery(object, minDist, maxDist, i, count);
        this.group.add(object);
        pool.push(object);
      }
      return pool;
    };

    // Lightweight crossed cards remain only in the distance. Nearby silhouettes
    // are supplied by several optimized 3D species below.
    if (IS_MOBILE) {
      // Each crossed-card tree becomes one merged geometry and one instanced
      // draw call. This replaces dozens of individual transparent meshes.
      treePrototypes.forEach((prototype) => {
        const mergedTree = mergeStaticModel(prototype);
        this._makeInstancedPool(mergedTree, 12, 8.5, 14, 30, 74, { widthScale: 1 });
      });
      this.trees = [];
    } else {
      this.trees = makePool(treePrototypes, 48, 8.5, 14, 30, 74);
    }

    Promise.all([
      loadModel(loader, MODEL_URLS.boulder),
      loadModel(loader, MODEL_URLS.rock),
      loadModel(loader, MODEL_URLS.fern),
      loadModel(loader, MODEL_URLS.grass),
      loadModel(loader, MODEL_URLS.pineTree),
      loadModel(loader, MODEL_URLS.islandTree),
      loadModel(loader, MODEL_URLS.jacarandaTree),
    ]).then(([boulder, rock, fern, grass, pineTree, islandTree, jacarandaTree]) => {
      const boulders = boulder ? [boulder] : [];
      const rocks = rock ? [rock] : [];
      const ferns = fern ? [fern] : [];
      const grasses = grass ? [mergeStaticModel(grass)] : [];
      const realTrees = [pineTree, islandTree, jacarandaTree].filter(Boolean);
      boulders.forEach((model) => configurePBR(model));
      rocks.forEach((model) => configurePBR(model));
      ferns.forEach((model) => configurePBR(model, { foliage: true }));
      grasses.forEach((model) => configurePBR(model, { shadows: false, foliage: true }));
      realTrees.forEach((model) => {
        configurePBR(model, { shadows: false, foliage: true });
        model.traverse((object) => {
          if (object.isMesh) object.receiveShadow = true;
        });
      });

      // A few true 3D species near the road greatly improve silhouettes;
      // crossed-card trees remain in the distance to keep draw cost bounded.
      this.trees.push(...makePool(realTrees, IS_MOBILE ? 3 : 9, 8, 14.5, 16, 45));

      this.props = [
        ...makePool(boulders, scaledCount(20, 7), 1.4, 2.8, 13, 42),
        ...makePool(rocks, scaledCount(34, 12), 0.45, 1.15, 10, 25),
        ...makePool(ferns, scaledCount(42, 14), 0.55, 1.05, 12, 30),
      ];
      if (grasses[0]) this._makeInstancedPool(grasses[0], scaledCount(72, 28), 0.3, 0.64, 13, 28);

      const bush = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshStandardMaterial({ color: 0x3f6c32, roughness: 0.96, metalness: 0 }),
      );
      this._makeInstancedPool(bush, scaledCount(34, 14), 0.55, 1.25, 15, 48, {
        widthScale: 1.35,
        colors: [0x315b29, 0x476f35, 0x5b7d3c],
      });

      const flowerGeometry = new THREE.ConeGeometry(0.12, 0.42, 5);
      flowerGeometry.translate(0, 0.21, 0);
      const flower = new THREE.Mesh(
        flowerGeometry,
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true }),
      );
      this._makeInstancedPool(flower, scaledCount(110, 36), 0.2, 0.42, 13, 36, {
        widthScale: 0.65,
        colors: [0xf4d84e, 0xf1f0d2, 0xc6a6e8, 0xe89b5b],
      });
      this.reset(0);
    });

    this.reset(0);
  }

  _placeScenery(object, minDist, maxDist, slot = Math.random(), count = 1) {
    const side = slot % 2 === 0 ? -1 : 1;
    const z = 30 - (slot / count) * 380 + (Math.random() - 0.5) * 14;
    const lane = (slot * 0.6180339887) % 1;
    const lateral = side * (minDist + lane * (maxDist - minDist));
    object.userData.lateral = lateral;
    roadPoint(z, lateral, 0, object.position);
    object.position.y = terrainHeightAt(object.position.x, z);
    object.rotation.y = Math.random() * Math.PI * 2;
    object.scale.multiplyScalar(0.82 + Math.random() * 0.42);
  }

  _recycle(object, playerZ, minDist, maxDist) {
    if (object.position.z <= playerZ + 30) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    object.position.z = playerZ - 280 - Math.random() * 120;
    object.userData.lateral = side * (minDist + Math.random() * (maxDist - minDist));
    roadPoint(object.position.z, object.userData.lateral, 0, object.position);
    object.position.y = terrainHeightAt(object.position.x, object.position.z);
    object.rotation.y = Math.random() * Math.PI * 2;
  }

  _makeInstancedPool(prototype, count, heightMin, heightMax, minDist, maxDist, options = {}) {
    const geometry = prototype.geometry.clone();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = box.getSize(new THREE.Vector3());
    geometry.translate(-(box.min.x + size.x / 2), -box.min.y, -(box.min.z + size.z / 2));
    const mesh = new THREE.InstancedMesh(geometry, prototype.material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = options.castShadow ?? (!IS_MOBILE);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const items = [];
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      items.push({
        z: 30 - (i / count) * 400 + (Math.random() - 0.5) * 18,
        lateral: side * (minDist + Math.random() * (maxDist - minDist)),
        scale: (heightMin + Math.random() * (heightMax - heightMin)) / Math.max(size.y, 0.001),
        yaw: Math.random() * Math.PI * 2,
      });
      if (options.colors) mesh.setColorAt(i, new THREE.Color(options.colors[i % options.colors.length]));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const pool = { mesh, items, minDist, maxDist, widthScale: options.widthScale || 1 };
    this.instancedPools.push(pool);
    this.group.add(mesh);
    this._updateInstancedPool(pool, 0, true);
    return pool;
  }

  _updateInstancedPool(pool, playerZ, reset) {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    let changed = false;
    for (let i = 0; i < pool.items.length; i++) {
      const item = pool.items[i];
      if (reset) item.z = playerZ + 30 - Math.random() * 400;
      const recycled = item.z > playerZ + 30;
      if (recycled) {
        item.z = playerZ - 290 - Math.random() * 130;
        item.lateral = (Math.random() < 0.5 ? -1 : 1) * (pool.minDist + Math.random() * (pool.maxDist - pool.minDist));
        item.yaw = Math.random() * Math.PI * 2;
      }
      if (!reset && !recycled) continue;
      roadPoint(item.z, item.lateral, 0, position);
      position.y = terrainHeightAt(position.x, position.z);
      quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, item.yaw);
      scale.set(item.scale * pool.widthScale, item.scale, item.scale * pool.widthScale);
      matrix.compose(position, quaternion, scale);
      pool.mesh.setMatrixAt(i, matrix);
      changed = true;
    }
    if (changed) pool.mesh.instanceMatrix.needsUpdate = true;
  }

  update(playerZ) {
    // Recycle on exact grid multiples. The terrain rows are 7.5m apart and
    // 120m is an exact multiple, so the replacement slice lands on identical
    // world vertices instead of producing a visible sideways/vertical pop.
    const groundCenterZ = -300 - Math.floor(Math.max(0, -playerZ) / 120) * 120;
    // Keep terrain fixed in world space while the car moves. Recycle a large,
    // deterministic, grid-aligned slice only after 120m; moving it every frame caused the
    // curved shoulder layers to slide and visibly snap against the road.
    if (groundCenterZ !== this.terrainCenterZ) {
      for (const mesh of this.terrainMeshes) {
        mesh.position.z = groundCenterZ;
        updateTerrainGeometry(mesh.geometry, groundCenterZ);
      }
      this.terrainCenterZ = groundCenterZ;
      const offset = -(groundCenterZ / TERRAIN_LENGTH) * this.terrainRepeat.y;
      for (const texture of this.terrainTextures) texture.offset.y = offset;
    }

    for (const tree of this.trees) {
      const [minDist, maxDist] = tree.userData.recycleRange || [15, 68];
      this._recycle(tree, playerZ, minDist, maxDist);
    }
    for (const prop of this.props) {
      const [minDist, maxDist] = prop.userData.recycleRange || [10, 48];
      this._recycle(prop, playerZ, minDist, maxDist);
    }
    for (const pool of this.instancedPools) this._updateInstancedPool(pool, playerZ, false);
  }

  reset(playerZ = 0) {
    this.update(playerZ);
    for (const object of [...this.trees, ...this.props]) {
      object.position.z = playerZ + 30 - Math.random() * 380;
      roadPoint(object.position.z, object.userData.lateral || 20, 0, object.position);
      object.position.y = terrainHeightAt(object.position.x, object.position.z);
    }
    for (const pool of this.instancedPools) this._updateInstancedPool(pool, playerZ, true);
  }
}
