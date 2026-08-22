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

const canvas = document.getElementById('game');
const { renderer, scene, camera, update: updateScene } = createScene(canvas);

const road = new Road(scene);
const environment = new Environment(scene);
const car = new Car(scene);
const traffic = new Traffic(scene);
const effects = new Effects(scene, camera);
const hud = new HUD();
const input = new Input();

let state = 'start'; // start | playing | crashed
let score = 0;
let lives = 3;
const MAX_LIVES = 3;
let invulnerable = 0; // seconds of blink after a hit
let camPos = new THREE.Vector3(0, 4.2, 9);
let camLook = new THREE.Vector3(0, 1, -10);

function startGame() {
  car.reset();
  traffic.reset();
  road.reset(0);
  environment.reset(0);
  camPos.set(0, 4.2, 9);
  camLook.set(0, 1, -10);
  score = 0;
  lives = MAX_LIVES;
  invulnerable = 0;
  hud.setLives(lives);
  state = 'playing';
  hud.hideStart();
  hud.hideGameOver();
}

function hit() {
  if (state !== 'playing' || invulnerable > 0) return;
  lives -= 1;
  hud.setLives(lives, MAX_LIVES);
  hud.crashFlash();
  if (lives <= 0) {
    state = 'crashed';
    car.crashed = true;
    setTimeout(() => hud.showGameOver(score), 500);
  } else {
    invulnerable = 2.0; // brief mercy window with blinking
  }
}

hud.bind(startGame, startGame);
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && state === 'crashed') startGame();
  if (e.code === 'Enter' && state === 'start') startGame();
});

const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const frameTime = clock.getDelta();
  const dt = Math.min(frameTime, 0.05);

  if (state === 'playing') {
    if (invulnerable > 0) {
      invulnerable -= dt;
      car.group.visible = Math.floor(invulnerable * 10) % 2 === 0 || invulnerable <= 0;
    } else {
      car.group.visible = true;
    }

    car.update(dt, input);
    car.z -= car.speed * dt;
    car.syncToRoad();

    // Score: distance + speed bonus
    score += car.speed * dt * (1 + car.speed / 60);

    traffic.update(dt, car.z, car.x, () => {
      score += 50;
      hud.showNearMiss();
    }, hit);
  }

  // World updates (always, so scene looks alive behind menus)
  road.update(car.z);
  environment.update(car.z);
  updateScene(car.group.position);
  effects.update(dt, car, car.nitroActive && state === 'playing', state === 'crashed');

  // Chase camera: smooth follow with speed pullback
  const speedPull = Math.min(car.speed / 88, 1);
  const targetPos = roadPoint(car.z + 9 + speedPull * 2.5, car.x * 0.55, 4.2 + speedPull * 0.6);
  const targetLook = roadPoint(car.z - 12, car.x * 0.8, 1.1);
  const lerp = Math.min(1, dt * 5);
  camPos.lerp(targetPos, lerp);
  camLook.lerp(targetLook, lerp);
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
