import { roadCenterX } from './path.js';
import { RACE_CHECKPOINTS, RACE_DIFFICULTIES, RACE_DISTANCE, RACE_ROUTE_NAME } from './race.js';

const ordinal = (position) => `${position}${position === 1 ? 'st' : position === 2 ? 'nd' : position === 3 ? 'rd' : 'th'}`;

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.max(0, seconds - minutes * 60);
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}

// HUD updates and game state screens
export class HUD {
  constructor() {
    this.scoreEl = document.getElementById('score');
    this.speedEl = document.getElementById('speed');
    this.nitroFill = document.getElementById('nitro-fill');
    this.nearMissEl = document.getElementById('nearmiss');
    this.flashEl = document.getElementById('flash');
    this.startScreen = document.getElementById('start-screen');
    this.raceSetupScreen = document.getElementById('race-setup-screen');
    this.gameoverScreen = document.getElementById('gameover-screen');
    this.pauseScreen = document.getElementById('pause-screen');
    this.pauseButton = document.getElementById('pause-btn');
    this.endlessHud = document.getElementById('endless-hud');
    this.raceHud = document.getElementById('race-hud');
    this.racePositionEl = document.getElementById('race-position');
    this.raceMetaEl = document.getElementById('race-meta');
    this.raceProgressText = document.getElementById('race-progress-text');
    this.raceProgressFill = document.getElementById('race-progress-fill');
    this.raceTimeEl = document.getElementById('race-time');
    this.minimapWrap = document.getElementById('minimap-wrap');
    this.minimap = document.getElementById('minimap');
    this.minimapContext = this.minimap.getContext('2d');
    this.countdownEl = document.getElementById('countdown');
    this.raceResultsScreen = document.getElementById('race-results-screen');
    this.raceResultPosition = document.getElementById('race-result-position');
    this.raceResultStats = document.getElementById('race-result-stats');
    this.finalScoreEl = document.getElementById('final-score');
    this.livesEl = document.getElementById('lives');
    this.fpsEl = document.getElementById('fps');
    this.timeIndicator = document.getElementById('time-indicator');

    this.nearMissTimer = null;
    this.fpsFrames = 0;
    this.fpsElapsed = 0;
    this.displayFps = 60;
    this._buildMinimapBase();
  }

  bind({ startEndless, startRace, openRaceSetup, closeRaceSetup, restart, pause, resume, menu, selectDifficulty, selectTime, cycleTime }) {
    document.getElementById('start-endless-btn').addEventListener('click', startEndless);
    document.getElementById('start-race-btn').addEventListener('click', openRaceSetup);
    document.getElementById('confirm-race-btn').addEventListener('click', startRace);
    document.getElementById('setup-back-btn').addEventListener('click', closeRaceSetup);
    document.getElementById('restart-btn').addEventListener('click', restart);
    document.getElementById('pause-restart-btn').addEventListener('click', restart);
    document.getElementById('race-again-btn').addEventListener('click', startRace);
    document.getElementById('results-menu-btn').addEventListener('click', menu);
    this.pauseButton.addEventListener('click', pause);
    document.getElementById('resume-btn').addEventListener('click', resume);
    for (const button of document.querySelectorAll('.difficulty-btn')) {
      button.addEventListener('click', () => selectDifficulty(button.dataset.difficulty));
    }
    for (const button of document.querySelectorAll('.time-btn')) {
      button.addEventListener('click', () => selectTime(button.dataset.time));
    }
    this.timeIndicator.addEventListener('click', cycleTime);
  }

  update(car, score) {
    this.scoreEl.textContent = Math.floor(score);
    this.speedEl.innerHTML = `${car.kmh}<small> km/h</small>`;
    this.nitroFill.style.width = `${(car.nitroAmount * 100).toFixed(1)}%`;
  }

  updateFps(frameTime) {
    this.fpsFrames += 1;
    this.fpsElapsed += frameTime;
    if (this.fpsElapsed < 0.5) return;

    const measured = this.fpsFrames / this.fpsElapsed;
    this.displayFps = this.displayFps * 0.35 + measured * 0.65;
    this.fpsEl.innerHTML = `${Math.round(this.displayFps)}<small> FPS</small>`;
    this.fpsFrames = 0;
    this.fpsElapsed = 0;
  }

  setLives(n, total = 3) {
    this.livesEl.innerHTML =
      '❤'.repeat(Math.max(0, n)) +
      `<span class="lost">${'❤'.repeat(Math.max(0, total - n))}</span>`;
  }

  showNearMiss(text = 'NEAR MISS +50') {
    this.nearMissEl.textContent = text;
    this.nearMissEl.style.opacity = '1';
    clearTimeout(this.nearMissTimer);
    this.nearMissTimer = setTimeout(() => { this.nearMissEl.style.opacity = '0'; }, 700);
  }

  crashFlash() {
    this.flashEl.getAnimations().forEach((animation) => animation.cancel());
    this.flashEl.animate(
      [{ opacity: 0.58 }, { opacity: 0 }],
      { duration: 260, easing: 'ease-out' },
    );
  }

  showStart() {
    this.startScreen.style.display = 'flex';
    this.raceSetupScreen.style.display = 'none';
    this.timeIndicator.style.display = 'none';
    this.gameoverScreen.style.display = 'none';
    this.raceResultsScreen.style.display = 'none';
    this.countdownEl.style.display = 'none';
    this.showPauseButton(false);
  }

  hideStart() {
    this.startScreen.style.display = 'none';
    this.raceSetupScreen.style.display = 'none';
    this.timeIndicator.style.display = 'block';
  }

  showRaceSetup() {
    this.startScreen.style.display = 'none';
    this.raceSetupScreen.style.display = 'flex';
    this.timeIndicator.style.display = 'none';
  }

  hideRaceSetup() {
    this.raceSetupScreen.style.display = 'none';
    this.startScreen.style.display = 'flex';
  }

  showGameOver(score) {
    this.finalScoreEl.textContent = Math.floor(score);
    this.gameoverScreen.style.display = 'flex';
  }

  hideGameOver() {
    this.gameoverScreen.style.display = 'none';
  }

  showPause() {
    this.pauseScreen.style.display = 'flex';
    this.pauseButton.style.display = 'none';
  }

  hidePause() {
    this.pauseScreen.style.display = 'none';
  }

  showPauseButton(show) {
    this.pauseButton.style.display = show ? 'block' : 'none';
  }

  setMode(mode) {
    const race = mode === 'race';
    this.endlessHud.style.display = race ? 'none' : 'block';
    this.raceHud.style.display = race ? 'block' : 'none';
    this.minimapWrap.style.display = race ? 'block' : 'none';
  }

  setDifficulty(difficulty) {
    const resolved = RACE_DIFFICULTIES[difficulty] ? difficulty : 'normal';
    for (const button of document.querySelectorAll('.difficulty-btn')) {
      button.classList.toggle('active', button.dataset.difficulty === resolved);
    }
    this.raceMetaEl.textContent = `${RACE_ROUTE_NAME} · ${RACE_DIFFICULTIES[resolved].label}`;
  }

  setTimeMode(mode) {
    for (const button of document.querySelectorAll('.time-btn')) {
      button.classList.toggle('active', button.dataset.time === mode);
    }
  }

  updateTime(profile, mode) {
    this.timeIndicator.textContent = `${profile.icon} ${profile.label}${mode === 'auto' ? ' · AUTO' : ''}`;
  }

  showCountdown(value) {
    if (!value) {
      this.countdownEl.style.display = 'none';
      return;
    }
    this.countdownEl.textContent = value;
    this.countdownEl.style.display = 'flex';
    this.countdownEl.animate(
      [{ transform: 'scale(1.35)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 220, easing: 'cubic-bezier(.2,.9,.25,1)' },
    );
  }

  updateRace({ position, progress, time, standings, playerX }) {
    const ratio = Math.max(0, Math.min(1, progress / RACE_DISTANCE));
    this.racePositionEl.innerHTML = `${ordinal(position)} <small>/ 4</small>`;
    this.raceProgressText.textContent = `${(progress / 1000).toFixed(2)} / ${(RACE_DISTANCE / 1000).toFixed(2)} km`;
    this.raceProgressFill.style.width = `${ratio * 100}%`;
    this.raceTimeEl.textContent = formatTime(time);
    this._drawMinimap(progress, standings, playerX);
  }

  showRaceResults(position, time, topSpeed, difficulty = 'normal', bestTime = time, isRecord = false) {
    this.countdownEl.style.display = 'none';
    this.showPauseButton(false);
    this.raceResultPosition.textContent = ordinal(position);
    const difficultyLabel = RACE_DIFFICULTIES[difficulty]?.label || RACE_DIFFICULTIES.normal.label;
    this.raceResultStats.innerHTML = [
      `${RACE_ROUTE_NAME} · ${difficultyLabel}`,
      `Time ${formatTime(time)}${isRecord ? ' · NEW BEST' : ''}`,
      `Best ${formatTime(bestTime)}`,
      `Top speed ${Math.round(topSpeed)} km/h`,
    ].join('<br/>');
    this.raceResultsScreen.style.display = 'flex';
  }

  hideRaceResults() {
    this.raceResultsScreen.style.display = 'none';
  }

  _mapPoint(progress, lateral = 0) {
    const width = this.minimap.width;
    const height = this.minimap.height;
    const z = -Math.max(0, Math.min(RACE_DISTANCE, progress));
    const curve = (roadCenterX(z) - roadCenterX(0)) * 2.6;
    return {
      x: width / 2 + curve + lateral * 2.2,
      y: height - 18 - (progress / RACE_DISTANCE) * (height - 36),
    };
  }

  _buildMinimapBase() {
    this.minimapBase = document.createElement('canvas');
    this.minimapBase.width = this.minimap.width;
    this.minimapBase.height = this.minimap.height;
    const ctx = this.minimapBase.getContext('2d');
    ctx.fillStyle = '#07101a';
    ctx.fillRect(0, 0, this.minimap.width, this.minimap.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 240; i++) {
      const point = this._mapPoint((i / 240) * RACE_DISTANCE);
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.strokeStyle = '#283746';
    ctx.lineWidth = 13;
    ctx.stroke();
    ctx.strokeStyle = '#91a8bb';
    ctx.lineWidth = 3;
    ctx.stroke();
    for (const checkpoint of RACE_CHECKPOINTS) {
      const point = this._mapPoint(checkpoint);
      ctx.fillStyle = checkpoint === RACE_DISTANCE ? '#ffd34e' : '#2abaff';
      ctx.fillRect(point.x - 7, point.y - 2, 14, 4);
    }
  }

  _drawMinimap(playerProgress, standings, playerX) {
    const ctx = this.minimapContext;
    ctx.drawImage(this.minimapBase, 0, 0);
    for (const entry of standings) {
      if (entry.player) continue;
      const point = this._mapPoint(entry.progress, entry.x || 0);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = `#${entry.color.toString(16).padStart(6, '0')}`;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const player = this._mapPoint(playerProgress, playerX);
    ctx.beginPath();
    ctx.arc(player.x, player.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ff334f';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
