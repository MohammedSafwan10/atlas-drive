import * as THREE from 'three';
import { createScene } from './scene.js';
import { Road } from './road.js';
import { Environment } from './environment.js';
import { Car } from './car.js';
import { Traffic } from './traffic.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { roadPoint, SEG_LEN } from './path.js';
import { IS_MOBILE } from './platform.js';
import { GameAudio } from './audio.js';
import { modeForSegment } from './features.js';
import { RaceCourse, RACE_CHECKPOINTS, RACE_DISTANCE } from './race.js';
import { TimeOfDay, TIME_MODES } from './timeOfDay.js';
import { WeatherSystem, WEATHER_MODES } from './weather.js';
import { FinishPresentation } from './finish.js';
import { LoadingGate } from './loading.js';
import { PerformanceDiagnostics } from './diagnostics.js';

const canvas = document.getElementById('game');

if (IS_MOBILE) {
  document.getElementById('loading-screen')?.remove();
  const blocker = document.getElementById('mobile-block-screen');
  if (blocker) {
    blocker.style.display = 'flex';
    const copyBtn = document.getElementById('mobile-copy-btn');
    const urlBox = blocker.querySelector('.mobile-url-box');
    if (urlBox && window.location.host) urlBox.textContent = window.location.host;
    copyBtn?.addEventListener('click', () => {
      const url = window.location.href;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          copyBtn.textContent = 'LINK COPIED! ✓';
          setTimeout(() => { copyBtn.textContent = '📋 COPY LINK FOR PC'; }, 2500);
        }).catch(() => {
          copyBtn.textContent = 'LINK COPIED! ✓';
        });
      }
    });
  }
}

const loadingGate = new LoadingGate();
const { renderer, scene, camera, update: updateScene, updatePerformance, setTimeOfDay, setWeatherIntensity } = createScene(canvas);

const road = new Road(scene);
const environment = new Environment(scene);
const car = new Car(scene);
const traffic = new Traffic(scene);
const raceCourse = new RaceCourse(scene);
const effects = new Effects(scene, camera, car);
const hud = new HUD();
const diagnostics = new PerformanceDiagnostics(renderer);
const input = new Input();
const audio = new GameAudio();
const timeOfDay = new TimeOfDay(setTimeOfDay);
const finishPresentation = new FinishPresentation(scene);
const weather = new WeatherSystem(scene, camera, road, audio, setWeatherIntensity);
const previewParams = new URLSearchParams(location.search);
const previewZ = import.meta.env.DEV
  ? Number(previewParams.get('previewZ'))
  : Number.NaN;
const previewBoost = import.meta.env.DEV && previewParams.has('previewBoost');

let state = 'loading'; // loading | start | countdown | playing | paused | crashed | finishCinematic | finished
let stateBeforePause = 'playing';
let gameMode = 'race'; // race | endless
let raceDifficulty = 'normal';
let menuInSetup = false;
let score = 0;
let lives = 3;
const MAX_LIVES = 3;
let invulnerable = 0; // seconds of blink after a hit
let impactShake = 0;
let raceImpactCooldown = 0;
let raceCountdown = 0;
let countdownStage = 0;
let raceTime = 0;
let raceTopSpeed = 0;
let playerCheckpoint = 0;
let camPos = new THREE.Vector3(0, IS_MOBILE ? 2.85 : 3.65, IS_MOBILE ? 5.2 : 7.2);
let camLook = new THREE.Vector3(0, 1, -10);
let suspended = document.hidden;
let pendingRaceResult = null;
let spawnWorldPrepared = false;

function resetCommon() {
  void audio.start().catch((error) => console.warn('Game audio unavailable', error));
  const needsWorldReset = !spawnWorldPrepared || Number.isFinite(previewZ);
  car.reset();
  if (Number.isFinite(previewZ)) {
    car.z = previewZ;
    car.syncToRoad();
  }
  if (previewBoost) {
    car.speed = 58;
    input.touch.gas = true;
    input.touch.nitro = true;
  }
  // The loading gate has already built the road/scenery at the starting grid.
  // Reusing it for the first launch avoids recomputing every road ribbon and
  // scenery instance in the same click that begins the countdown.
  if (needsWorldReset) {
    road.reset(car.z);
    environment.reset(car.z);
  }
  spawnWorldPrepared = true;
  camPos.set(0, IS_MOBILE ? 2.85 : 3.65, IS_MOBILE ? 5.2 : 7.2);
  camLook.set(0, 1, -10);
  score = 0;
  lives = MAX_LIVES;
  invulnerable = 0;
  impactShake = 0;
  raceImpactCooldown = 0;
  hud.setLives(lives);
  hud.hideStart();
  hud.hideGameOver();
  hud.hideRaceResults();
  hud.hidePause();
  hud.showPauseButton(true);
  raceTime = 0;
  raceTopSpeed = 0;
  playerCheckpoint = 0;
  pendingRaceResult = null;
  finishPresentation.stop();
  hud.showFinishCinematic(false);
  clock.getDelta();
}

let pendingMode = 'race';

function startEndless() {
  menuInSetup = false;
  gameMode = 'endless';
  resetCommon();
  traffic.reset();
  raceCourse.setVisible(false);
  hud.setMode('endless');
  hud.showCountdown('');
  state = 'playing';
  audio.ui(620);
}

function startRace() {
  menuInSetup = false;
  gameMode = 'race';
  resetCommon();
  car.x = 0;
  car.syncToRoad();
  traffic.resetRace(raceDifficulty);
  raceCourse.setVisible(true);
  hud.setMode('race');
  raceCountdown = 3.25;
  countdownStage = 4;
  state = 'countdown';
  input.clearAll();
  hud.showCountdown('3');
  audio.ui(440);
}

function openSetup(mode = 'race') {
  if (state !== 'start') return;
  pendingMode = mode;
  menuInSetup = true;
  hud.showRaceSetup(mode);
  audio.ui(560);
}

function confirmLaunch() {
  if (pendingMode === 'race') startRace();
  else startEndless();
}

function closeRaceSetup() {
  if (state !== 'start') return;
  menuInSetup = false;
  hud.hideRaceSetup();
  audio.ui(420);
}

function selectDifficulty(difficulty) {
  if (!['easy', 'normal', 'hard'].includes(difficulty)) return;
  raceDifficulty = difficulty;
  hud.setDifficulty(difficulty);
  try { localStorage.setItem('atlas-drive-race-difficulty', difficulty); } catch { /* storage may be disabled */ }
  audio.ui(difficulty === 'hard' ? 760 : difficulty === 'easy' ? 480 : 620);
}

function selectTime(mode) {
  timeOfDay.setMode(mode);
  hud.setTimeMode(timeOfDay.mode);
  audio.ui(mode === 'night' ? 420 : mode === 'sunset' ? 540 : 660);
}

function selectWeather(mode) {
  weather.setMode(mode);
  hud.setWeatherMode(weather.mode);
  audio.ui(mode === 'storm' ? 380 : mode === 'clear' ? 720 : 560);
}

function cycleTime() {
  const next = TIME_MODES[(TIME_MODES.indexOf(timeOfDay.mode) + 1) % TIME_MODES.length];
  selectTime(next);
}

function restartGame() {
  if (gameMode === 'race') startRace();
  else startEndless();
}

function showMenu() {
  state = 'start';
  menuInSetup = false;
  input.clearAll();
  finishPresentation.stop();
  car.reset();
  traffic.reset();
  road.reset(0);
  environment.reset(0);
  spawnWorldPrepared = true;
  camPos.set(0, IS_MOBILE ? 2.85 : 3.65, IS_MOBILE ? 5.2 : 7.2);
  camLook.set(0, 1, -10);
  raceCourse.setVisible(false);
  hud.setMode('endless');
  hud.hidePause();
  hud.hideRaceResults();
  hud.showStart();
  hud.showFinishCinematic(false);
  audio.setPaused(true);
}

function pauseGame() {
  if (state !== 'playing' && state !== 'countdown') return;
  stateBeforePause = state;
  state = 'paused';
  input.clearAll();
  audio.setPaused(true);
  audio.ui(420);
  hud.showPause();
}

function resumeGame() {
  if (state !== 'paused') return;
  state = stateBeforePause;
  input.clearAll();
  audio.setPaused(false);
  audio.ui(680);
  clock.getDelta();
  hud.hidePause();
  hud.showPauseButton(true);
}

function hit() {
  if (gameMode !== 'endless' || state !== 'playing' || invulnerable > 0) return;
  lives -= 1;
  car.speed *= 0.65;
  car.x = THREE.MathUtils.clamp(car.x + (car.x >= 0 ? 0.75 : -0.75), -4.8, 4.8);
  audio.crash();
  impactShake = lives <= 0 ? 0.42 : 0.28;
  if (IS_MOBILE && navigator.vibrate) navigator.vibrate(lives <= 0 ? [90, 45, 120] : 70);
  hud.setLives(lives, MAX_LIVES);
  hud.crashFlash();
  if (lives <= 0) {
    state = 'crashed';
    car.crashed = true;
    hud.showPauseButton(false);
    setTimeout(() => hud.showGameOver(score), 600);
  } else {
    invulnerable = 1.8;
  }
}

function raceCollision(rival) {
  if (state !== 'playing' || raceImpactCooldown > 0) return;
  raceImpactCooldown = 0.9;
  car.speed *= 0.72;
  const separation = car.x <= rival.x ? -1 : 1;
  car.x = THREE.MathUtils.clamp(car.x + separation * 0.78, -4.9, 4.9);
  rival.x = THREE.MathUtils.clamp(rival.x - separation * 0.22, -4.6, 4.6);
  rival.targetX = rival.x;
  impactShake = 0.2;
  audio.crash();
  hud.crashFlash();
  if (IS_MOBILE && navigator.vibrate) navigator.vibrate(55);
}

function finishRace() {
  if (state === 'finished' || state === 'finishCinematic') return;
  const standings = traffic.getRaceStandings(car.z);
  const position = standings.findIndex((entry) => entry.player) + 1;
  state = 'finishCinematic';
  car.nitroActive = false;
  input.clearAll();
  hud.showCountdown('');
  const recordKey = `atlas-drive-best-${raceDifficulty}`;
  let previousBest = Number.POSITIVE_INFINITY;
  try { previousBest = Number(localStorage.getItem(recordKey)) || Number.POSITIVE_INFINITY; } catch { /* storage may be disabled */ }
  const isRecord = raceTime < previousBest;
  const bestTime = isRecord ? raceTime : previousBest;
  if (isRecord) {
    try { localStorage.setItem(recordKey, String(raceTime)); } catch { /* storage may be disabled */ }
  }
  pendingRaceResult = { position, time: raceTime, topSpeed: raceTopSpeed, difficulty: raceDifficulty, bestTime, isRecord };
  finishPresentation.start(car, traffic, standings);
  hud.showFinishCinematic(true);
  audio.finish(position);
}

function completeFinishPresentation() {
  if (!pendingRaceResult || state === 'finished') return;
  state = 'finished';
  const result = pendingRaceResult;
  hud.showRaceResults(result.position, result.time, result.topSpeed, result.difficulty, result.bestTime, result.isRecord);
}

function skipFinish() {
  if (state !== 'finishCinematic') return;
  finishPresentation.skipToPodium();
  audio.ui(760);
}

hud.bind({
  openSetup,
  confirmLaunch,
  closeRaceSetup,
  restart: restartGame,
  pause: pauseGame,
  resume: resumeGame,
  menu: showMenu,
  selectDifficulty,
  selectTime,
  selectWeather,
  cycleTime,
  skipFinish,
});
addEventListener('keydown', (e) => {
  if (e.code === 'F8') {
    e.preventDefault();
    diagnostics.toggle();
  }
  if (e.code === 'KeyR' && (state === 'crashed' || state === 'finished')) restartGame();
  if (e.code === 'Enter' && state === 'start') {
    if (menuInSetup) confirmLaunch();
    else openSetup('race');
  }
  if (e.code === 'Escape' && state === 'start' && menuInSetup) closeRaceSetup();
  if ((e.code === 'Escape' || e.code === 'KeyP') && (state === 'playing' || state === 'countdown')) pauseGame();
  else if ((e.code === 'Escape' || e.code === 'KeyP') && state === 'paused') resumeGame();
  if (e.code === 'KeyM') audio.toggleMute();
  if (import.meta.env.DEV && e.code === 'KeyL') weather.forceLightning(0);
  if ((e.code === 'Space' || e.code === 'Enter') && state === 'finishCinematic') skipFinish();
});

const clock = new THREE.Clock();

document.addEventListener('visibilitychange', () => {
  suspended = document.hidden;
  input.clearAll();
  if (suspended && (state === 'playing' || state === 'countdown')) pauseGame();
  if (!suspended) clock.getDelta();
});

function tick() {
  requestAnimationFrame(tick);
  const frameTime = clock.getDelta();
  diagnostics.recordFrame(frameTime);
  const dt = Math.min(frameTime, 0.05);
  raceImpactCooldown = Math.max(0, raceImpactCooldown - dt);

  if (suspended) return;
  updatePerformance(frameTime);
  const timeProfile = timeOfDay.update(state === 'paused' ? 0 : dt);
  hud.updateTime(timeProfile, timeOfDay.mode);
  const currentRoadMode = modeForSegment(Math.round(car.z / SEG_LEN));
  const weatherIntensity = weather.update(
    state === 'paused' ? 0 : dt,
    car,
    state === 'playing' || state === 'finishCinematic',
    currentRoadMode === 'tunnel',
  );
  const darkness = Math.max(timeProfile.night, weatherIntensity * 0.82);
  road.setNightFactor(darkness);
  car.setNightFactor(darkness);
  traffic.setNightFactor(darkness, car.z);

  if (state === 'countdown') {
    raceCountdown -= dt;
    const stage = Math.max(0, Math.ceil(raceCountdown));
    if (stage !== countdownStage) {
      countdownStage = stage;
      if (stage > 0) {
        hud.showCountdown(String(stage));
        audio.ui(440 + (3 - stage) * 70);
      } else {
        hud.showCountdown('GO!');
        audio.ui(880);
        state = 'playing';
        if (previewBoost) {
          car.speed = 58;
          input.touch.gas = true;
          input.touch.nitro = true;
        }
        setTimeout(() => {
          if (state === 'playing') hud.showCountdown('');
        }, 650);
      }
    }
    traffic.updateRace(dt, car, false, raceCollision);
  }

  if (state === 'playing') {
    spawnWorldPrepared = false;
    if (invulnerable > 0) invulnerable -= dt;
    car.group.visible = true;

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

    if (gameMode === 'endless') {
      // Score: distance + speed bonus
      score += car.speed * dt * (1 + car.speed / 60);
      traffic.update(dt, car.z, car.x, () => {
        score += 50;
        hud.showNearMiss();
        audio.nearMiss();
      }, () => {
        if (!car.airborne) hit(); // flying over traffic is safe
      });
    } else {
      raceTime += dt;
      raceTopSpeed = Math.max(raceTopSpeed, car.kmh);
      traffic.updateRace(dt, car, true, raceCollision);
      raceCourse.update(car.z);
      const progress = Math.max(0, -car.z);
      while (playerCheckpoint < RACE_CHECKPOINTS.length - 1 && progress >= RACE_CHECKPOINTS[playerCheckpoint]) {
        playerCheckpoint += 1;
        hud.showNearMiss(`CHECKPOINT ${playerCheckpoint} / ${RACE_CHECKPOINTS.length - 1}`);
        audio.ui(700 + playerCheckpoint * 70);
      }
      if (progress >= RACE_DISTANCE) finishRace();
    }
  }

  if (state === 'finishCinematic' || state === 'finished') {
    car.speed *= Math.exp(-dt * 1.6);
  }

  // Freeze simulation/effects while paused; the last frame remains rendered.
  if (state !== 'paused') {
    road.update(car.z);
    environment.update(car.z);
    updateScene(car.group.position);
    effects.update(dt, car, car.nitroActive && state === 'playing', state === 'crashed');
  }

  if (finishPresentation.active && (state === 'finishCinematic' || state === 'finished')) {
    const finishState = finishPresentation.update(state === 'paused' ? 0 : dt, camera);
    if (finishState.complete) completeFinishPresentation();
  } else {
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
    camPos.copy(targetPos);
    camLook.copy(targetLook);

    // Apply impact impulse smoothly to camera position before projection
    if (impactShake > 0) {
      impactShake = Math.max(0, impactShake - dt);
      const strength = Math.min(1, impactShake / 0.22) * 0.12;
      camPos.x += (Math.random() - 0.5) * strength;
      camPos.y += (Math.random() - 0.5) * strength;
    }

    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  hud.update(car, score);
  if (gameMode === 'race') {
    const standings = traffic.getRaceStandings(car.z);
    const position = standings.findIndex((entry) => entry.player) + 1;
    hud.updateRace({
      position,
      progress: Math.max(0, -car.z),
      time: raceTime,
      standings,
      playerX: car.x,
    });
  }
  hud.updateFps(frameTime);
  audio.update(
    car,
    state === 'playing' || state === 'countdown',
    currentRoadMode === 'tunnel',
    gameMode === 'race'
      ? traffic.cars.slice(0, 3).map((rival) => ({ x: rival.x, z: rival.z, speed: rival.speed }))
      : [],
  );
  renderer.render(scene, camera);
}

hud.setMode('endless');
try {
  selectDifficulty(localStorage.getItem('atlas-drive-race-difficulty') || 'normal');
} catch {
  hud.setDifficulty(raceDifficulty);
}
try {
  selectTime(localStorage.getItem('atlas-drive-time-mode') || 'auto');
} catch {
  hud.setTimeMode('auto');
}
try {
  selectWeather(previewParams.get('weather') || localStorage.getItem('atlas-drive-weather-mode') || 'auto');
} catch {
  hud.setWeatherMode('auto');
}
if (import.meta.env.DEV && previewParams.has('previewLightning')) weather.forceLightning();
tick();

async function boot() {
  // Finish decoding/building the real models, scenery and audio before the
  // loader can disappear. Then compile the exact starting grid the player
  // will see, so the first race click cannot trigger shader/texture uploads.
  await Promise.all([car.ready, traffic.ready, environment.ready, audio.preload()]);
  await hud.warmUpImpactLayers();
  car.reset();
  road.reset(0);
  environment.reset(0);
  spawnWorldPrepared = true;
  traffic.resetRace(raceDifficulty);
  raceCourse.setVisible(true);
  effects.warmUp(renderer, scene, camera);
  traffic.warmUp(renderer, scene, camera);
  traffic.resetRace(raceDifficulty);
  setTimeOfDay(timeOfDay.update(0), true);
  await loadingGate.reveal(renderer, scene, camera);
  traffic.reset();
  raceCourse.setVisible(false);
  state = 'start';
  clock.getDelta();
  hud.showStart();
  if (previewParams.has('diagnostics')) diagnostics.show();
}

boot().catch((error) => {
  // Never strand the player behind a loader if GPU warm-up fails unexpectedly.
  console.error('Startup warm-up failed', error);
  document.getElementById('loading-screen')?.remove();
  state = 'start';
  hud.showStart();
});
