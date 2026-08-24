import * as THREE from 'three';
import { placeOnRoad } from './path.js';

export const RACE_DISTANCE = 2000;
export const RACE_CHECKPOINTS = [500, 1000, 1500, RACE_DISTANCE];
export const RACER_NAMES = ['YOU', 'APEX', 'VOLT', 'NOVA'];

function makeCanvasTexture(draw, width = 1024, height = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeRoadStripe() {
  const texture = makeCanvasTexture((ctx, width, height) => {
    const size = height / 2;
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < Math.ceil(width / size); x++) {
        ctx.fillStyle = (x + y) % 2 ? '#111820' : '#f4f5f2';
        ctx.fillRect(x * size, y * size, size, size);
      }
    }
  });
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(12.25, 1.15), material);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.y = 0.055;
  return stripe;
}

function makeGantry(label, accent) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x222a34, roughness: 0.32, metalness: 0.88 });
  const poleGeometry = new THREE.CylinderGeometry(0.15, 0.2, 6.2, 10);
  for (const x of [-6.8, 6.8]) {
    const pole = new THREE.Mesh(poleGeometry, metal);
    pole.position.set(x, 3.1, 0);
    group.add(pole);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(13.8, 0.22, 0.22), metal);
  beam.position.y = 6.05;
  group.add(beam);

  const bannerTexture = makeCanvasTexture((ctx, width, height) => {
    ctx.fillStyle = '#0a1018';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, width, 18);
    ctx.fillRect(0, height - 18, width, 18);
    ctx.font = '900 142px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, width / 2, height / 2 + 2);
  });
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(7.4, 1.8),
    new THREE.MeshBasicMaterial({ map: bannerTexture, side: THREE.DoubleSide, toneMapped: false }),
  );
  banner.position.set(0, 5.18, 0);
  group.add(banner);
  return group;
}

function makeCheckpointBoard(number) {
  const group = new THREE.Group();
  const texture = makeCanvasTexture((ctx, width, height) => {
    ctx.fillStyle = '#0b1d2d';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#22b8ff';
    ctx.fillRect(0, 0, 28, height);
    ctx.font = '700 56px Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#9fdcff';
    ctx.fillText('CHECKPOINT', 62, 78);
    ctx.font = '900 106px Segoe UI, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(number), 62, 172);
  });
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 3.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x303945, roughness: 0.48, metalness: 0.7 }),
  );
  post.position.y = 1.75;
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 1.2),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }),
  );
  board.position.set(-1.05, 2.75, 0);
  group.add(post, board);
  return group;
}

export class RaceCourse {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    const start = makeGantry('START', '#28a8ff');
    start.add(makeRoadStripe());
    // Keep the grid behind the gantry so the banner frames the road instead of
    // sitting directly above the chase camera at the countdown.
    placeOnRoad(start, -14);
    this.group.add(start);

    const finish = makeGantry('FINISH', '#ffbf28');
    finish.add(makeRoadStripe());
    placeOnRoad(finish, -RACE_DISTANCE);
    this.group.add(finish);

    RACE_CHECKPOINTS.slice(0, -1).forEach((distance, index) => {
      const marker = makeCheckpointBoard(index + 1);
      placeOnRoad(marker, -distance, index % 2 ? -7.8 : 7.8);
      this.group.add(marker);
    });
  }

  setVisible(visible) {
    this.group.visible = visible;
  }
}
