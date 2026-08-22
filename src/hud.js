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
    this.pauseScreen = document.getElementById('pause-screen');
    this.pauseButton = document.getElementById('pause-btn');
    this.finalScoreEl = document.getElementById('final-score');
    this.livesEl = document.getElementById('lives');
    this.fpsEl = document.getElementById('fps');

    this.nearMissTimer = null;
    this.fpsFrames = 0;
    this.fpsElapsed = 0;
    this.displayFps = 60;
  }

  bind(startFn, restartFn, pauseFn, resumeFn) {
    this.onStart = startFn;
    this.onRestart = restartFn;
    document.getElementById('start-btn').addEventListener('click', startFn);
    document.getElementById('restart-btn').addEventListener('click', restartFn);
    document.getElementById('pause-restart-btn').addEventListener('click', restartFn);
    this.pauseButton.addEventListener('click', pauseFn);
    document.getElementById('resume-btn').addEventListener('click', resumeFn);
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
}
