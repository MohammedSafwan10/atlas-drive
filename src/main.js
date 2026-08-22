import * as THREE from 'three';
import { createScene } from './scene.js';
import { Road } from './road.js';
import { Environment } from './environment.js';
import { Car } from './car.js';
import { Traffic } from './traffic.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { roadPoint } from './path.js';
import { IS_MOBILE } from './platform.js';

const canvas = document.getElementById('game');
const { renderer, scene, camera, update: updateScene, updatePerformance } = createScene(canvas);

const road = new Road(scene);
const environment = new Environment(scene);
const car = new Car(scene);
const traffic = new Traffic(scene);
const effects = new Effects(scene, camera);
const hud = new HUD();
const input = new Input();
const previewZ = import.meta.env.DEV
  ? Number(new URLSearchParams(location.search).get('previewZ'))
  : Number.NaN;

let state = 'start'; // start | playing | paused | crashed
let score = 0;
let lives = 3;
const MAX_LIVES = 3;
let invulnerable = 0; // seconds of blink after a hit
let camPos = new THREE.Vector3(0, IS_MOBILE ? 2.85 : 3.65, IS_MOBILE ? 5.2 : 7.2);
let camLook = new THREE.Vector3(0, 1, -10);
let suspended = document.hidden;

function startGame() {
  car.reset();
  if (Number.isFinite(previewZ)) {
    car.z = previewZ;
    car.syncToRoad();
  }
  traffic.reset();
  road.reset(car.z);
  environment.reset(car.z);
  camPos.set(0, IS_MOBILE ? 2.85 : 3.65, IS_MOBILE ? 5.2 : 7.2);
  camLook.set(0, 1, -10);
  score = 0;
  lives = MAX_LIVES;
  invulnerable = 0;
  hud.setLives(lives);
  state = 'playing';
  hud.hideStart();
  hud.hideGameOver();
  hud.hidePause();
  hud.showPauseButton(true);
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  input.clearAll();
  hud.showPause();
}

function resumeGame() {
  if (state !== 'paused') return;
  state = 'playing';
  input.clearAll();
  clock.getDelta();
  hud.hidePause();
  hud.showPauseButton(true);
}

function hit() {
  if (state !== 'playing' || invulnerable > 0) return;
  lives -= 1;
  // Give impact immediate physical feedback and let the traffic pull away.
  // Keeping the player model visible avoids the old two-second "glitch" blink.
  car.speed *= 0.5;
  hud.setLives(lives, MAX_LIVES);
  hud.crashFlash();
  if (lives <= 0) {
    state = 'crashed';
    car.crashed = true;
    hud.showPauseButton(false);
    setTimeout(() => hud.showGameOver(score), 500);
  } else {
    invulnerable = 1.15;
  }
}

hud.bind(startGame, startGame, pauseGame, resumeGame);
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && state === 'crashed') startGame();
  if (e.code === 'Enter' && state === 'start') startGame();
  if ((e.code === 'Escape' || e.code === 'KeyP') && state === 'playing') pauseGame();
  else if ((e.code === 'Escape' || e.code === 'KeyP') && state === 'paused') resumeGame();
});

const clock = new THREE.Clock();

document.addEventListener('visibilitychange', () => {
  suspended = document.hidden;
  input.clearAll();
  if (suspended && state === 'playing') pauseGame();
  if (!suspended) clock.getDelta();
});

function tick() {
  requestAnimationFrame(tick);
  const frameTime = clock.getDelta();
  const dt = Math.min(frameTime, 0.05);

  if (suspended) return;
  updatePerformance(frameTime);

  if (state === 'playing') {
    if (invulnerable > 0) {
      invulnerable -= dt;
      car.group.visible = true;
    } else {
      car.group.visible = true;
    }

    car.update(dt, input);
    car.z -= car.speed * dt;
    car.syncToRoad();

    // Air-time bonus from ramp jumps
    if (car.justLanded) {
      const bonus = 50 + Math.round(car.lastAirTime * 250);
      score += bonus;
      hud.showNearMiss(`AIR TIME +${bonus}`);
      car.justLanded = false;
    }

    // Score: distance + speed bonus
    score += car.speed * dt * (1 + car.speed / 60);

    traffic.update(dt, car.z, car.x, () => {
      score += 50;
      hud.showNearMiss();
    }, () => {
      if (!car.airborne) hit(); // flying over traffic is safe
    });
  }

  // Freeze simulation/effects while paused; the last frame remains rendered.
  if (state !== 'paused') {
    road.update(car.z);
    environment.update(car.z);
    updateScene(car.group.position);
    effects.update(dt, car, car.nitroActive && state === 'playing', state === 'crashed');
  }

  // Chase camera: smooth follow with speed pullback
  const speedPull = Math.min(car.speed / 88, 1);
  const chaseDistance = IS_MOBILE ? 5.2 : 7.2;
  const chaseHeight = IS_MOBILE ? 2.85 : 3.65;
  const targetPos = roadPoint(
    car.z + chaseDistance + speedPull * (IS_MOBILE ? 0.25 : 1.5),
    car.x * 0.62,
    chaseHeight + speedPull * (IS_MOBILE ? 0.16 : 0.42),
  );
  const targetLook = roadPoint(car.z - (IS_MOBILE ? 15 : 14), car.x * 0.82, 0.95);
  // Anchor the chase rig in the same moving road frame as the car. Interpolating
  // world-space Z created both speed-dependent zoom-out and visible hunting.
  camPos.copy(targetPos);
  camLook.copy(targetLook);
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  // Crash shake
  if (state === 'crashed') {
    camera.position.x += (Math.random() - 0.5) * 0.15;
    camera.position.y += (Math.random() - 0.5) * 0.15;
  }

  hud.update(car, score);
  hud.updateFps(frameTime);
  renderer.render(scene, camera);
}

hud.showStart();
tick();
