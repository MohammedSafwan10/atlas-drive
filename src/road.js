import * as THREE from 'three';
import { placeOnRoad, roadPoint } from './path.js';

export const LANE_X = [-3.6, 0, 3.6];
const SEG_LEN = 120;
const SEG_COUNT = 6;
const STEP = 4;

function makeAsphaltMaterial() {
  const loader = new THREE.TextureLoader();
  const diff = loader.load('/assets/asphalt_diff.jpg');
  const nor = loader.load('/assets/asphalt_nor.jpg');
  const rough = loader.load('/assets/asphalt_rough.jpg');
  for (const texture of [diff, nor, rough]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, SEG_LEN / 8);
    texture.anisotropy = 8;
  }
  diff.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: diff, normalMap: nor, roughnessMap: rough, roughness: 1 });
}

function makeRibbon(centerZ, left, right, lift = 0.02, length = SEG_LEN, step = STEP) {
  const rows = Math.round(length / step) + 1;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(rows * 6);
  const uvs = new Float32Array(rows * 4);
  const indices = [];
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  for (let row = 0; row < rows; row++) {
    uvs.set([0, row / (rows - 1), 1, row / (rows - 1)], row * 4);
    if (row < rows - 1) {
      const a = row * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setIndex(indices);
  geometry.userData.ribbon = { centerZ, left, right, lift, length, step, vertical: false };
  updateRibbon(geometry, centerZ);
  return geometry;
}

function makeVerticalRibbon(centerZ, lateral, low, high, step = STEP) {
  const geometry = makeRibbon(centerZ, lateral, lateral, 0, SEG_LEN, step);
  geometry.userData.ribbon = { centerZ, lateral, low, high, length: SEG_LEN, step, vertical: true };
  updateRibbon(geometry, centerZ);
  return geometry;
}

function updateRibbon(geometry, centerZ) {
  const data = geometry.userData.ribbon;
  data.centerZ = centerZ;
  const positions = geometry.getAttribute('position');
  const rows = positions.count / 2;
  const point = new THREE.Vector3();
  for (let row = 0; row < rows; row++) {
    const z = centerZ + data.length / 2 - row * data.step;
    if (data.vertical) {
      roadPoint(z, data.lateral, data.low, point);
      positions.setXYZ(row * 2, point.x, point.y, point.z);
      roadPoint(z, data.lateral, data.high, point);
      positions.setXYZ(row * 2 + 1, point.x, point.y, point.z);
    } else {
      roadPoint(z, data.left, data.lift, point);
      positions.setXYZ(row * 2, point.x, point.y, point.z);
      roadPoint(z, data.right, data.lift, point);
      positions.setXYZ(row * 2 + 1, point.x, point.y, point.z);
    }
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function makeRoadSign(materials) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 2.8, 8), materials.pole);
  pole.position.y = 1.4;
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.72, 0.07), materials.sign);
  board.position.y = 2.45;
  board.castShadow = true;
  group.add(pole, board);
  return group;
}

function makeUtilityPole(materials) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 7.5, 8), materials.wood);
  pole.position.y = 3.75;
  const cross = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.12), materials.wood);
  cross.position.y = 7.1;
  group.add(pole, cross);
  return group;
}

export class Road {
  constructor(scene) {
    this.group = new THREE.Group();
    this.segments = [];
    scene.add(this.group);

    const materials = {
      asphalt: makeAsphaltMaterial(),
      line: new THREE.MeshStandardMaterial({ color: 0xf5f4e9, roughness: 0.55, emissive: 0x181816 }),
      rail: new THREE.MeshStandardMaterial({ color: 0xbcc4cb, roughness: 0.28, metalness: 0.92, side: THREE.DoubleSide }),
      pole: new THREE.MeshStandardMaterial({ color: 0x545b63, roughness: 0.62, metalness: 0.55 }),
      reflector: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 1.8 }),
      sign: new THREE.MeshStandardMaterial({ color: 0x2462a4, roughness: 0.42, metalness: 0.35, emissive: 0x061525 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x5a4634, roughness: 0.95 }),
      fence: new THREE.MeshStandardMaterial({ color: 0x6f6658, roughness: 0.95, side: THREE.DoubleSide }),
      lamp: new THREE.MeshStandardMaterial({ color: 0x26292d, emissive: 0xffe6a3, emissiveIntensity: 0.75 }),
    };

    for (let i = 0; i < SEG_COUNT; i++) {
      const segment = { centerZ: -i * SEG_LEN, ribbons: [], fixtures: [] };
      const addRibbon = (geometry, material, shadows = false) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true;
        mesh.castShadow = shadows;
        this.group.add(mesh);
        segment.ribbons.push(mesh);
        return mesh;
      };

      addRibbon(makeRibbon(segment.centerZ, -6.6, 6.6, 0), materials.asphalt);
      addRibbon(makeRibbon(segment.centerZ, -6.18, -6.0, 0.035), materials.line);
      addRibbon(makeRibbon(segment.centerZ, 6.0, 6.18, 0.035), materials.line);

      for (const lane of [-1.8, 1.8]) {
        for (let offset = -SEG_LEN / 2 + 3; offset < SEG_LEN / 2; offset += 8) {
          const dash = addRibbon(makeRibbon(segment.centerZ + offset, lane - 0.08, lane + 0.08, 0.04, 3.4, 1.7), materials.line);
          dash.geometry.userData.shortOffset = offset;
        }
      }

      for (const side of [-1, 1]) {
        addRibbon(makeVerticalRibbon(segment.centerZ, side * 7, 0.54, 0.68), materials.rail, true);
        addRibbon(makeVerticalRibbon(segment.centerZ, side * 7, 0.76, 0.9), materials.rail, true);
        addRibbon(makeVerticalRibbon(segment.centerZ, side * 18, 0.65, 0.73, 6), materials.fence);
        addRibbon(makeVerticalRibbon(segment.centerZ, side * 18, 1.15, 1.23, 6), materials.fence);

        for (let offset = -SEG_LEN / 2 + 4; offset < SEG_LEN / 2; offset += 8) {
          const post = new THREE.Group();
          const stem = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.82, 0.18), materials.rail);
          stem.position.y = 0.41;
          const reflector = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.18), materials.reflector);
          reflector.position.set(-side * 0.07, 0.78, 0);
          post.add(stem, reflector);
          this.group.add(post);
          segment.fixtures.push({ object: post, offset, lateral: side * 7, height: 0 });
        }
        for (let offset = -SEG_LEN / 2 + 6; offset < SEG_LEN / 2; offset += 12) {
          const fencePost = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.35, 0.12), materials.wood);
          this.group.add(fencePost);
          segment.fixtures.push({ object: fencePost, offset, lateral: side * 18, height: 0.68 });
        }
      }

      for (let offset = -SEG_LEN / 2 + 18; offset < SEG_LEN / 2; offset += 40) {
        const side = ((i + Math.round(offset / 40)) & 1) ? -1 : 1;
        const light = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 7.5, 8), materials.pole);
        pole.position.y = 3.75;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.12), materials.pole);
        arm.position.set(-side * 0.95, 7.42, 0);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.15, 0.3), materials.lamp);
        lamp.position.set(-side * 1.75, 7.32, 0);
        light.add(pole, arm, lamp);
        this.group.add(light);
        segment.fixtures.push({ object: light, offset, lateral: side * 8.2, height: 0 });
      }

      const sign = makeRoadSign(materials);
      this.group.add(sign);
      segment.fixtures.push({ object: sign, offset: -25, lateral: (i % 2 ? -1 : 1) * 9.4, height: -0.45 });
      const utility = makeUtilityPole(materials);
      this.group.add(utility);
      segment.fixtures.push({ object: utility, offset: 24, lateral: (i % 2 ? 1 : -1) * 22, height: 1.35 });

      this.segments.push(segment);
      this._updateSegment(segment, segment.centerZ);
    }
  }

  _updateSegment(segment, centerZ) {
    segment.centerZ = centerZ;
    for (const mesh of segment.ribbons) {
      updateRibbon(mesh.geometry, centerZ + (mesh.geometry.userData.shortOffset || 0));
    }
    for (const fixture of segment.fixtures) {
      placeOnRoad(fixture.object, centerZ + fixture.offset, fixture.lateral, fixture.height);
    }
  }

  update(playerZ) {
    for (const segment of this.segments) {
      if (segment.centerZ - SEG_LEN / 2 > playerZ + 40) {
        this._updateSegment(segment, Math.min(...this.segments.map((entry) => entry.centerZ)) - SEG_LEN);
      }
    }
  }

  reset(playerZ = 0) {
    for (let i = 0; i < this.segments.length; i++) this._updateSegment(this.segments[i], playerZ - i * SEG_LEN);
  }
}
