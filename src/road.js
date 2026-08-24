import * as THREE from 'three';
import { SEG_LEN, placeOnRoad, roadPoint } from './path.js';
import { modeForSegment } from './features.js';
import { GRAPHICS, IS_MOBILE } from './platform.js';

export const LANE_X = [-3.6, 0, 3.6];
const SEG_COUNT = IS_MOBILE ? 4 : 6;
const STEP = IS_MOBILE ? 6 : 4;

// Which segment modes each ribbon/fixture kind is visible in (null = always)
const RIBBON_MODES = {
  rail: ['open', 'ramp', 'bridge'],
  fence: ['open', 'ramp'],
  bridgeWall: ['bridge'],
  ramp: ['ramp'],
  rampSide: ['ramp'],
};
const FIXTURE_MODES = {
  railpost: ['open', 'ramp'],
  fencepost: ['open', 'ramp'],
  light: ['open', 'ramp', 'bridge'],
  sign: ['open', 'ramp'],
  utility: ['open', 'ramp'],
  portal: ['tunnel'],
  pillar: ['bridge'],
};

function makeAsphaltMaterial() {
  const loader = new THREE.TextureLoader();
  const diff = loader.load('/assets/asphalt_diff.jpg');
  const nor = loader.load('/assets/asphalt_nor.jpg');
  const rough = loader.load('/assets/asphalt_rough.jpg');
  for (const texture of [diff, nor, rough]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, SEG_LEN / 8);
    texture.anisotropy = GRAPHICS.anisotropy;
  }
  diff.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({
    map: diff,
    ...(!IS_MOBILE && { normalMap: nor, roughnessMap: rough }),
    roughness: 1,
  });
}

function makeConcreteMaterial() {
  const loader = new THREE.TextureLoader();
  const diff = loader.load('/assets/terrain/concrete_diff.jpg');
  const nor = loader.load('/assets/terrain/concrete_nor.jpg');
  const rough = loader.load('/assets/terrain/concrete_rough.jpg');
  for (const texture of [diff, nor, rough]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 6);
    texture.anisotropy = GRAPHICS.anisotropy;
  }
  diff.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({
    map: diff,
    ...(!IS_MOBILE && { normalMap: nor, roughnessMap: rough }),
    color: 0xb8b2a6,
    roughness: 0.94,
    metalness: 0,
  });
}

function makeRibbon(centerZ, left, right, lift = 0.02, length = SEG_LEN, step = STEP, liftProfile = null) {
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
  geometry.userData.ribbon = { centerZ, left, right, lift, length, step, vertical: false, liftProfile };
  updateRibbon(geometry, centerZ);
  return geometry;
}

function makeVerticalRibbon(centerZ, lateral, low, high, step = STEP) {
  const geometry = makeRibbon(centerZ, lateral, lateral, 0, SEG_LEN, step);
  geometry.userData.ribbon = { centerZ, lateral, low, high, length: SEG_LEN, step, vertical: true };
  updateRibbon(geometry, centerZ);
  return geometry;
}

function rampLiftProfile(u) {
  return Math.pow(THREE.MathUtils.clamp(u / 0.86, 0, 1), 1.28);
}

function makeRampSide(centerZ, lateral, maxLift, length = 10, step = 0.65) {
  const rows = Math.round(length / step) + 1;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(rows * 6);
  const uvs = new Float32Array(rows * 4);
  const indices = [];
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  for (let row = 0; row < rows; row++) {
    const u = row / (rows - 1);
    uvs.set([u, 0, u, 1], row * 4);
    if (row < rows - 1) {
      const a = row * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setIndex(indices);
  geometry.userData.rampSide = { centerZ, lateral, maxLift, length, step };
  updateRampSide(geometry, centerZ);
  return geometry;
}

function updateRampSide(geometry, centerZ) {
  const data = geometry.userData.rampSide;
  data.centerZ = centerZ;
  const positions = geometry.getAttribute('position');
  const rows = positions.count / 2;
  const point = new THREE.Vector3();
  for (let row = 0; row < rows; row++) {
    const u = row / (rows - 1);
    const z = centerZ + data.length / 2 - u * data.length;
    roadPoint(z, data.lateral, 0.035, point);
    positions.setXYZ(row * 2, point.x, point.y, point.z);
    roadPoint(z, data.lateral, data.maxLift * rampLiftProfile(u), point);
    positions.setXYZ(row * 2 + 1, point.x, point.y, point.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

// Curved arch shell that follows the road (used for tunnel tube + light bands)
const SHELL_COLS = 8;

function makeShell(centerZ, radius, thetaA, thetaB, length = SEG_LEN, step = 4) {
  const rows = Math.round(length / step) + 1;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(rows * SHELL_COLS * 3);
  const uvs = new Float32Array(rows * SHELL_COLS * 2);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const indices = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < SHELL_COLS - 1; col++) {
      const a = row * SHELL_COLS + col;
      indices.push(a, a + SHELL_COLS, a + 1, a + 1, a + SHELL_COLS, a + SHELL_COLS + 1);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < SHELL_COLS; col++) {
      const index = (row * SHELL_COLS + col) * 2;
      uvs[index] = col / (SHELL_COLS - 1);
      uvs[index + 1] = row / (rows - 1);
    }
  }
  geometry.setIndex(indices);
  geometry.userData.shell = { centerZ, radius, thetaA, thetaB, length, step };
  updateShell(geometry, centerZ);
  return geometry;
}

function updateShell(geometry, centerZ) {
  const data = geometry.userData.shell;
  data.centerZ = centerZ;
  const positions = geometry.getAttribute('position');
  const rows = positions.count / SHELL_COLS;
  const point = new THREE.Vector3();
  for (let row = 0; row < rows; row++) {
    const z = centerZ + data.length / 2 - row * data.step;
    for (let col = 0; col < SHELL_COLS; col++) {
      const t = col / (SHELL_COLS - 1);
      const theta = data.thetaA + (data.thetaB - data.thetaA) * t;
      roadPoint(z, Math.sin(theta) * data.radius, Math.cos(theta) * data.radius, point);
      positions.setXYZ(row * SHELL_COLS + col, point.x, point.y, point.z);
    }
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function makePortal(materials) {
  const group = new THREE.Group();
  const arch = new THREE.Mesh(
    new THREE.RingGeometry(8.45, 10.15, IS_MOBILE ? 20 : 32, 1, 0, Math.PI),
    materials.concrete,
  );
  arch.castShadow = !IS_MOBILE;
  arch.receiveShadow = true;
  group.add(arch);
  return group;
}

function updateRibbon(geometry, centerZ) {
  const data = geometry.userData.ribbon;
  data.centerZ = centerZ;
  const positions = geometry.getAttribute('position');
  const rows = positions.count / 2;
  const point = new THREE.Vector3();
  for (let row = 0; row < rows; row++) {
    const z = centerZ + data.length / 2 - row * data.step;
    const u = row / (rows - 1);
    const lift = data.liftProfile ? data.lift * data.liftProfile(u) : data.lift;
    if (data.vertical) {
      roadPoint(z, data.lateral, data.low, point);
      positions.setXYZ(row * 2, point.x, point.y, point.z);
      roadPoint(z, data.lateral, data.high, point);
      positions.setXYZ(row * 2 + 1, point.x, point.y, point.z);
    } else {
      roadPoint(z, data.left, lift, point);
      positions.setXYZ(row * 2, point.x, point.y, point.z);
      roadPoint(z, data.right, lift, point);
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

    const asphaltMaterial = makeAsphaltMaterial();
    const concreteMaterial = makeConcreteMaterial();
    const tunnelMaterial = concreteMaterial.clone();
    tunnelMaterial.side = THREE.DoubleSide;
    tunnelMaterial.color.set(0x8c8982);
    // Emissive fill approximates bounced tunnel light without expensive mobile
    // point lights, keeping the concrete readable instead of pitch black.
    tunnelMaterial.emissive.set(0x24221f);
    tunnelMaterial.emissiveIntensity = 0.45;
    const rampMaterial = asphaltMaterial.clone();
    rampMaterial.color.set(0x666a64);
    rampMaterial.roughness = 0.96;
    const rampConcreteMaterial = concreteMaterial.clone();
    rampConcreteMaterial.side = THREE.DoubleSide;
    const materials = {
      asphalt: asphaltMaterial,
      line: new THREE.MeshStandardMaterial({ color: 0xf5f4e9, roughness: 0.55, emissive: 0x181816 }),
      rail: new THREE.MeshStandardMaterial({ color: 0xbcc4cb, roughness: 0.28, metalness: 0.92, side: THREE.DoubleSide }),
      pole: new THREE.MeshStandardMaterial({ color: 0x545b63, roughness: 0.62, metalness: 0.55 }),
      reflector: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 1.8 }),
      sign: new THREE.MeshStandardMaterial({ color: 0x2462a4, roughness: 0.42, metalness: 0.35, emissive: 0x061525 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x5a4634, roughness: 0.95 }),
      fence: new THREE.MeshStandardMaterial({ color: 0x6f6658, roughness: 0.95, side: THREE.DoubleSide }),
      lamp: new THREE.MeshStandardMaterial({ color: 0x26292d, emissive: 0xffe6a3, emissiveIntensity: 0.75 }),
      concrete: concreteMaterial,
      tunnel: tunnelMaterial,
      tunnelLight: new THREE.MeshStandardMaterial({
        color: 0x8e8978,
        emissive: 0xffd8a0,
        emissiveIntensity: 0.52,
        roughness: 0.72,
        side: THREE.DoubleSide,
      }),
      ramp: rampMaterial,
      rampConcrete: rampConcreteMaterial,
      hazard: new THREE.MeshStandardMaterial({
        color: 0xffbd28,
        emissive: 0x6b3900,
        emissiveIntensity: 0.8,
        roughness: 0.58,
        metalness: 0.05,
      }),
    };
    this.materials = materials;

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

      addRibbon(makeRibbon(segment.centerZ, -6.6, 6.6, 0), materials.asphalt).userData.kind = 'asphalt';
      addRibbon(makeRibbon(segment.centerZ, -6.18, -6.0, 0.035), materials.line).userData.kind = 'line';
      addRibbon(makeRibbon(segment.centerZ, 6.0, 6.18, 0.035), materials.line).userData.kind = 'line';

      for (const lane of [-1.8, 1.8]) {
        if (IS_MOBILE) {
          addRibbon(makeRibbon(segment.centerZ, lane - 0.055, lane + 0.055, 0.04), materials.line).userData.kind = 'line';
        } else {
          for (let offset = -SEG_LEN / 2 + 3; offset < SEG_LEN / 2; offset += 8) {
            const dash = addRibbon(makeRibbon(segment.centerZ + offset, lane - 0.08, lane + 0.08, 0.04, 3.4, 1.7), materials.line);
            dash.geometry.userData.shortOffset = offset;
            dash.userData.kind = 'line';
          }
        }
      }

      for (const side of [-1, 1]) {
        addRibbon(makeVerticalRibbon(segment.centerZ, side * 7, 0.54, 0.68), materials.rail, true).userData.kind = 'rail';
        if (!IS_MOBILE) {
          addRibbon(makeVerticalRibbon(segment.centerZ, side * 7, 0.76, 0.9), materials.rail, true).userData.kind = 'rail';
          addRibbon(makeVerticalRibbon(segment.centerZ, side * 18, 0.65, 0.73, 6), materials.fence).userData.kind = 'fence';
          addRibbon(makeVerticalRibbon(segment.centerZ, side * 18, 1.15, 1.23, 6), materials.fence).userData.kind = 'fence';
        }

        for (let offset = -SEG_LEN / 2 + 8; offset < SEG_LEN / 2; offset += IS_MOBILE ? 32 : 8) {
          const post = new THREE.Group();
          const stem = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.82, 0.18), materials.rail);
          stem.position.y = 0.41;
          post.add(stem);
          if (!IS_MOBILE) {
            const reflector = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.18), materials.reflector);
            reflector.position.set(-side * 0.07, 0.78, 0);
            post.add(reflector);
          }
          this.group.add(post);
          segment.fixtures.push({ object: post, offset, lateral: side * 7, height: 0, kind: 'railpost' });
        }
        if (!IS_MOBILE) {
          for (let offset = -SEG_LEN / 2 + 6; offset < SEG_LEN / 2; offset += 12) {
            const fencePost = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.35, 0.12), materials.wood);
            this.group.add(fencePost);
            segment.fixtures.push({ object: fencePost, offset, lateral: side * 18, height: 0.68, kind: 'fencepost' });
          }
        }
      }

      // ---- Feature decorations (toggled per segment mode in _updateSegment) ----

      // Tunnel tube + interior light bands
      addRibbon(makeShell(segment.centerZ, 8.6, -Math.PI / 2, Math.PI / 2), materials.tunnel).userData.kind = 'tunnelShell';
      // One restrained ceiling strip reads as a tunnel fixture. The previous
      // full-length side strips filled half the screen with clipped white wedges.
      addRibbon(makeShell(segment.centerZ, 8.48, -0.035, 0.035), materials.tunnelLight).userData.kind = 'tunnelLight';

      // Bridge parapet walls
      for (const side of [-1, 1]) {
        addRibbon(makeVerticalRibbon(segment.centerZ, side * 7, 0.5, 1.25, 4), materials.concrete, true).userData.kind = 'bridgeWall';
      }

      // Bridge support pillars reaching down toward the valley floor
      for (const offset of [-45, -15, 15, 45]) {
        for (const side of [-1, 1]) {
          const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.15, 18, 10), materials.concrete);
          pillar.castShadow = true;
          this.group.add(pillar);
          segment.fixtures.push({ object: pillar, offset, lateral: side * 4.8, height: -9.0, kind: 'pillar' });
        }
      }

      // Tunnel entrance/exit portals
      for (const offset of [-(SEG_LEN / 2 - 1), SEG_LEN / 2 - 1]) {
        const portal = makePortal(materials);
        this.group.add(portal);
        segment.fixtures.push({ object: portal, offset, lateral: 0, height: 0, kind: 'portal' });
      }

      // Raised asphalt wedges with concrete side faces and reflective edges.
      for (const offset of [-25, 20]) {
        const length = 10;
        const maxLift = 1.1;
        const ramp = addRibbon(
          makeRibbon(segment.centerZ + offset, -6.25, 6.25, maxLift, length, 0.65, rampLiftProfile),
          materials.ramp,
          true,
        );
        ramp.geometry.userData.shortOffset = offset;
        ramp.userData.kind = 'ramp';

        for (const side of [-1, 1]) {
          const edge = addRibbon(
            makeRibbon(
              segment.centerZ + offset,
              side * 6.22 - 0.12,
              side * 6.22 + 0.12,
              maxLift + 0.035,
              length,
              0.65,
              rampLiftProfile,
            ),
            materials.hazard,
          );
          edge.geometry.userData.shortOffset = offset;
          edge.userData.kind = 'ramp';

          const sideWall = addRibbon(
            makeRampSide(segment.centerZ + offset, side * 6.3, maxLift, length),
            materials.rampConcrete,
          );
          sideWall.geometry.userData.shortOffset = offset;
          sideWall.userData.kind = 'rampSide';
        }

        const lipMarker = addRibbon(
          makeRibbon(segment.centerZ + offset - length / 2 + 0.28, -6.2, 6.2, maxLift + 0.045, 0.48, 0.48),
          materials.hazard,
        );
        lipMarker.geometry.userData.shortOffset = offset - length / 2 + 0.28;
        lipMarker.userData.kind = 'ramp';
      }

      const lightOffsets = IS_MOBILE ? [0] : [-42, -2, 38];
      for (const offset of lightOffsets) {
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
        segment.fixtures.push({ object: light, offset, lateral: side * 8.2, height: 0, kind: 'light' });
      }

      const sign = makeRoadSign(materials);
      this.group.add(sign);
      segment.fixtures.push({ object: sign, offset: -25, lateral: (i % 2 ? -1 : 1) * 9.4, height: -0.45, kind: 'sign' });
      if (!IS_MOBILE) {
        const utility = makeUtilityPole(materials);
        this.group.add(utility);
        segment.fixtures.push({ object: utility, offset: 24, lateral: (i % 2 ? 1 : -1) * 22, height: 1.35, kind: 'utility' });
      }

      this.segments.push(segment);
      this._updateSegment(segment, segment.centerZ);
    }
  }

  setNightFactor(factor) {
    const night = THREE.MathUtils.clamp(factor, 0, 1);
    this.materials.lamp.emissiveIntensity = 0.28 + night * 5.4;
    this.materials.reflector.emissiveIntensity = 1.2 + night * 4.2;
    this.materials.sign.emissiveIntensity = 0.35 + night * 1.35;
    this.materials.line.emissiveIntensity = 0.28 + night * 0.72;
  }

  _updateSegment(segment, centerZ) {
    segment.centerZ = centerZ;
    const mode = modeForSegment(Math.round(centerZ / SEG_LEN));
    segment.mode = mode;
    for (const mesh of segment.ribbons) {
      const kind = mesh.userData.kind || 'asphalt';
      if (kind === 'tunnelShell' || kind === 'tunnelLight') {
        mesh.visible = mode === 'tunnel';
        updateShell(mesh.geometry, centerZ + (mesh.geometry.userData.shortOffset || 0));
      } else if (kind === 'rampSide') {
        mesh.visible = mode === 'ramp';
        updateRampSide(mesh.geometry, centerZ + (mesh.geometry.userData.shortOffset || 0));
      } else {
        const allowed = RIBBON_MODES[kind];
        mesh.visible = !allowed || allowed.includes(mode);
        updateRibbon(mesh.geometry, centerZ + (mesh.geometry.userData.shortOffset || 0));
      }
    }
    for (const fixture of segment.fixtures) {
      fixture.object.visible = FIXTURE_MODES[fixture.kind].includes(mode);
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
