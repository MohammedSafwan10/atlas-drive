// HUD updates and game state screens
export class HUD {
  constructor() {
    this.scoreEl = document.getElementById('score');
    this.speedEl = document.getElementById('speed');
    this.nitroFill = document.getElementById('nitro-fill');
    this.nearMissEl = document.getElementById('nearmiss');
    this.flashEl = document.getElementById('flash');
    this.startScreen = document.getElementById('start-screen');
    this.gameoverScreen = document.getElementById('gameover-screen');
    this.finalScoreEl = document.getElementById('final-score');
    this.livesEl = document.getElementById('lives');
    this.fpsEl = document.getElementById('fps');

    this.nearMissTimer = null;
    this.fpsFrames = 0;
    this.fpsElapsed = 0;
    this.displayFps = 60;
  }

  bind(startFn, restartFn) {
    this.onStart = startFn;
    this.onRestart = restartFn;
    document.getElementById('start-btn').addEventListener('click', startFn);
    document.getElementById('restart-btn').addEventListener('click', restartFn);
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

  showNearMiss() {
    this.nearMissEl.style.opacity = '1';
    clearTimeout(this.nearMissTimer);
    this.nearMissTimer = setTimeout(() => { this.nearMissEl.style.opacity = '0'; }, 700);
  }

  crashFlash() {
    this.flashEl.style.opacity = '0.9';
    setTimeout(() => { this.flashEl.style.transition = 'opacity 0.4s'; this.flashEl.style.opacity = '0'; }, 60);
  }

  showStart() {
    this.startScreen.style.display = 'flex';
    this.gameoverScreen.style.display = 'none';
  }

  hideStart() {
    this.startScreen.style.display = 'none';
  }

  showGameOver(score) {
    this.finalScoreEl.textContent = Math.floor(score);
    this.gameoverScreen.style.display = 'flex';
  }

  hideGameOver() {
    this.gameoverScreen.style.display = 'none';
  }
}
