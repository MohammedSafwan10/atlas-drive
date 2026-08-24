import * as THREE from 'three';

const GPU_RESERVE = 0.08;

function assetLabel(url) {
  const name = url.split('/').pop()?.split('?')[0] || 'asset';
  if (/ferrari|\.glb$/i.test(name)) return 'BUILDING 3D WORLD';
  if (/alps|sky|\.hdr$/i.test(name)) return 'PAINTING ALPINE SKY';
  if (/asphalt|terrain|forest|gravel|dirt/i.test(url)) return 'PREPARING ROAD SURFACES';
  if (/rain|thunder|\.mp3|\.ogg|\.wav/i.test(name)) return 'TUNING WEATHER AUDIO';
  return 'LOADING RACE ASSETS';
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export class LoadingGate {
  constructor(manager = THREE.DefaultLoadingManager) {
    this.root = document.getElementById('loading-screen');
    this.fill = document.getElementById('loading-fill');
    this.percent = document.getElementById('loading-percent');
    this.status = document.getElementById('loading-status');
    this.detail = document.getElementById('loading-detail');
    this.target = 0.02;
    this.shown = 0;
    this.errors = 0;
    this.finished = false;

    this.assetsReady = new Promise((resolve) => { this.resolveAssets = resolve; });

    manager.onStart = (url, loaded, total) => this.update(url, loaded, total);
    manager.onProgress = (url, loaded, total) => this.update(url, loaded, total);
    manager.onError = (url) => {
      this.errors += 1;
      console.warn(`Asset failed to load: ${url}`);
    };
    manager.onLoad = () => this.resolveAssets();

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  update(url, loaded, total) {
    const ratio = total > 0 ? loaded / total : 0;
    this.target = Math.max(this.target, Math.min(1 - GPU_RESERVE, ratio * (1 - GPU_RESERVE)));
    this.status.textContent = assetLabel(url);
    this.detail.textContent = `${loaded} / ${total} ASSETS`;
  }

  animate() {
    if (this.finished) return;
    this.shown += (this.target - this.shown) * 0.12;
    if (this.target - this.shown < 0.001) this.shown = this.target;
    const percentage = Math.round(this.shown * 100);
    this.fill.style.transform = `scaleX(${this.shown})`;
    this.percent.textContent = `${percentage}%`;
    this.root.setAttribute('aria-valuenow', String(percentage));
    requestAnimationFrame(this.animate);
  }

  async reveal(renderer, scene, camera) {
    await this.assetsReady;
    this.status.textContent = 'OPTIMIZING GRAPHICS';
    this.detail.textContent = 'WARMING GPU SHADERS';
    this.target = 0.96;

    try {
      if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
      else renderer.compile(scene, camera);
    } catch (error) {
      console.warn('Async shader warm-up unavailable; using renderer fallback.', error);
      renderer.compile(scene, camera);
    }

    // Render behind the opaque gate so texture uploads and the first complete
    // frame happen before the player ever sees the scene.
    renderer.render(scene, camera);
    await nextFrame();
    renderer.render(scene, camera);
    await nextFrame();

    this.target = 1;
    this.shown = 1;
    this.fill.style.transform = 'scaleX(1)';
    this.percent.textContent = '100%';
    this.root.setAttribute('aria-valuenow', '100');
    this.status.textContent = this.errors ? 'READY WITH FALLBACKS' : 'READY TO RACE';
    this.detail.textContent = this.errors ? `${this.errors} OPTIONAL ASSET${this.errors === 1 ? '' : 'S'} SKIPPED` : 'ALPINE PASS READY';
    await new Promise((resolve) => setTimeout(resolve, 180));

    this.finished = true;
    this.root.classList.add('loading-complete');
    await new Promise((resolve) => setTimeout(resolve, 480));
    this.root.remove();
  }
}
