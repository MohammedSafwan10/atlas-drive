const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const ENGINE_FILES = [
  '/assets/audio/engine-low.ogg',
  '/assets/audio/engine-mid.ogg',
  '/assets/audio/engine-high.ogg',
];

const WEATHER_FILES = [
  '/assets/audio/rain-heavy-loop.ogg',
  '/assets/audio/thunder-1.ogg',
  '/assets/audio/thunder-2.ogg',
  '/assets/audio/thunder-3.ogg',
];

// Reactive game mix: three CC0 RPM bands plus lightweight synthesized effects.
export class GameAudio {
  constructor() {
    this.context = null;
    this.ready = false;
    this.loading = null;
    this.muted = false;
    this.paused = false;
    this.engineSources = [];
    this.engineGains = [];
    this.noiseBuffer = null;
    this.master = null;
    this.roadGain = null;
    this.nitroGain = null;
    this.rivalGain = null;
    this.rivalSource = null;
    this.weatherGain = null;
    this.recordedRainGain = null;
    this.recordedRainSource = null;
    this.thunderBuffers = [];
    this.crashVoices = [];
    this.lastKmh = 0;
    this.muteButton = document.getElementById('sound-btn');
    this.muteButton?.addEventListener('click', () => this.toggleMute());
  }

  init() {
    if (!this.loading) this.loading = this._init().catch((err) => console.warn('Audio pre-warm error', err));
    return this.loading;
  }

  // Decode audio while the loading screen is still opaque. Browsers keep the
  // context suspended until the player's first interaction, so this does not
  // autoplay anything; it only removes fetch/decode work from race launch.
  preload() {
    return this.init();
  }

  async start() {
    if (!this.loading) this.loading = this._init();
    if (this.context?.state === 'suspended') await this.context.resume();
    await this.loading;
    this.setPaused(false);
  }

  async _init() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass({ latencyHint: 'interactive' });
    this.context = context;

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 16;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;

    this.master = context.createGain();
    this.master.gain.value = 0.72;
    this.master.connect(compressor).connect(context.destination);

    const engineBus = context.createGain();
    const engineTone = context.createBiquadFilter();
    engineTone.type = 'lowpass';
    engineTone.frequency.value = 7200;
    engineTone.Q.value = 0.35;
    engineBus.connect(engineTone).connect(this.master);
    this.engineTone = engineTone;

    const buffers = await Promise.all(ENGINE_FILES.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Audio load failed: ${url}`);
      return context.decodeAudioData(await response.arrayBuffer());
    }));

    buffers.forEach((buffer) => {
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = 0;
      source.connect(gain).connect(engineBus);
      source.start();
      this.engineSources.push(source);
      this.engineGains.push(gain);
    });

    // One spatial rival layer represents the nearest opponent. Reusing the
    // mid-RPM buffer avoids three more always-running sources while still
    // providing useful proximity and overtaking feedback.
    this.rivalSource = context.createBufferSource();
    this.rivalGain = context.createGain();
    this.rivalPan = context.createStereoPanner();
    this.rivalSource.buffer = buffers[1];
    this.rivalSource.loop = true;
    this.rivalGain.gain.value = 0;
    this.rivalSource.connect(this.rivalGain).connect(this.rivalPan).connect(this.master);
    this.rivalSource.start();

    this.noiseBuffer = this._makeNoiseBuffer(2);
    this.tyreGain = this._makeNoiseLoop('bandpass', 1800, 2.5);
    this.roadGain = this._makeNoiseLoop('bandpass', 720, 0.75);
    this.nitroGain = this._makeNoiseLoop('highpass', 1450, 0.55);
    this.weatherGain = this._makeNoiseLoop('lowpass', 2600, 0.25);
    const weatherBuffers = await Promise.all(WEATHER_FILES.map(async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await context.decodeAudioData(await response.arrayBuffer());
      } catch {
        return null;
      }
    }));
    if (weatherBuffers[0]) {
      this.recordedRainSource = context.createBufferSource();
      this.recordedRainGain = context.createGain();
      this.recordedRainSource.buffer = weatherBuffers[0];
      this.recordedRainSource.loop = true;
      this.recordedRainGain.gain.value = 0;
      this.recordedRainSource.connect(this.recordedRainGain).connect(this.master);
      this.recordedRainSource.start();
    }
    this.thunderBuffers = weatherBuffers.slice(1).filter(Boolean);
    // Crash synthesis used to build its complete Web Audio graph on the first
    // collision. Keep a small one-shot pool ready so impact feedback starts
    // without allocating audio nodes on the render-critical collision frame.
    this.crashVoices = Array.from({ length: 4 }, () => this._createCrashVoice());
    this.ready = true;
    this.ui(520);
  }

  _createCrashVoice() {
    const noise = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const thud = this.context.createOscillator();
    const thudGain = this.context.createGain();
    noise.buffer = this.noiseBuffer;
    filter.type = 'lowpass';
    thud.type = 'triangle';
    gain.gain.value = 0;
    thudGain.gain.value = 0;
    noise.connect(filter).connect(gain).connect(this.master);
    thud.connect(thudGain).connect(this.master);
    return { noise, filter, gain, thud, thudGain };
  }

  _makeNoiseBuffer(seconds) {
    const length = Math.round(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.82 + white * 0.18;
      samples[i] = last;
    }
    return buffer;
  }

  _makeNoiseLoop(type, frequency, q) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    return gain;
  }

  update(car, playing, inTunnel = false, rivals = []) {
    if (!this.ready) return;
    const now = this.context.currentTime;
    const rpm = clamp(car.rpm || 0.18);
    const roadSpeed = clamp(car.speed / 88);
    const active = playing && !this.paused ? 1 : 0;
    const throttleLift = (0.4 + (car.throttleLoad || 0) * 0.6) * (car.nitroActive ? 1.13 : 1);

    const low = clamp(1 - rpm / 0.5);
    const mid = clamp(1 - Math.abs(rpm - 0.48) / 0.46);
    const high = clamp((rpm - 0.38) / 0.62);
    const weights = [low, mid, high];
    const rates = [0.82 + rpm * 0.28, 0.92 + rpm * 0.24, 0.98 + rpm * 0.2];
    for (let i = 0; i < 3; i++) {
      this.engineGains[i].gain.setTargetAtTime(weights[i] * active * 0.34 * throttleLift, now, 0.045);
      this.engineSources[i].playbackRate.setTargetAtTime(rates[i], now, 0.055);
    }

    this.roadGain.gain.setTargetAtTime(active * roadSpeed * roadSpeed * 0.16, now, 0.08);
    this.tyreGain.gain.setTargetAtTime(active * (car.slip || 0) * 0.08, now, 0.08);
    this.nitroGain.gain.setTargetAtTime(active * (car.nitroActive ? 0.24 : 0), now, 0.035);
    let nearest = null;
    let nearestDistance = Infinity;
    for (const rival of rivals) {
      const distance = Math.abs(rival.z - car.z);
      if (distance < nearestDistance) {
        nearest = rival;
        nearestDistance = distance;
      }
    }
    const rivalPresence = nearest ? clamp(1 - nearestDistance / 65) : 0;
    this.rivalGain.gain.setTargetAtTime(active * rivalPresence * 0.16, now, 0.07);
    this.rivalPan.pan.setTargetAtTime(nearest ? clamp((nearest.x - car.x) / 7, -0.8, 0.8) : 0, now, 0.08);
    this.rivalSource.playbackRate.setTargetAtTime(nearest ? 0.88 + clamp(nearest.speed / 70) * 0.28 : 0.9, now, 0.08);
    this.engineTone.frequency.setTargetAtTime(inTunnel ? 3900 : 7200, now, 0.12);
    this.master.gain.setTargetAtTime(this.muted ? 0 : (inTunnel ? 0.82 : 0.72), now, 0.08);
    this.lastKmh = car.kmh;
  }

  crash() {
    if (!this.ready || this.muted || !this.context || this.context.state !== 'running') return;
    try {
      const now = this.context.currentTime;
      const voice = this.crashVoices.shift() || this._createCrashVoice();
      const { noise, filter, gain, thud, thudGain } = voice;
      filter.frequency.setValueAtTime(1800, now);
      filter.frequency.linearRampToValueAtTime(120, now + 0.32);
      gain.gain.setValueAtTime(0.72, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.34);
      noise.start(now);
      noise.stop(now + 0.36);

      thud.frequency.setValueAtTime(105, now);
      thud.frequency.linearRampToValueAtTime(38, now + 0.22);
      thudGain.gain.setValueAtTime(0.42, now);
      thudGain.gain.linearRampToValueAtTime(0, now + 0.24);
      thud.start(now);
      thud.stop(now + 0.25);
      setTimeout(() => {
        if (this.context && this.crashVoices.length < 4) {
          this.crashVoices.push(this._createCrashVoice());
        }
      }, 420);
    } catch (e) {
      console.warn('Audio crash effect failed', e);
    }
  }

  nearMiss() {
    if (!this.ready || this.muted || !this.context || this.context.state !== 'running') return;
    try {
      const now = this.context.currentTime;
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      source.buffer = this.noiseBuffer;
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1600, now);
      filter.frequency.linearRampToValueAtTime(420, now + 0.22);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.24);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(now);
      source.stop(now + 0.25);
    } catch (e) {
      console.warn('Audio nearMiss effect failed', e);
    }
  }

  setWeather(intensity) {
    if (!this.ready || !this.weatherGain) return;
    const amount = clamp(intensity);
    const volume = this.paused ? 0 : amount * (this.recordedRainGain ? 0.035 : 0.18);
    this.weatherGain.gain.setTargetAtTime(volume, this.context.currentTime, 0.32);
    this.recordedRainGain?.gain.setTargetAtTime(this.paused ? 0 : amount * 0.28, this.context.currentTime, 0.5);
  }

  thunder(intensity = 1) {
    if (!this.ready || this.muted) return;
    const now = this.context.currentTime;
    const recorded = this.thunderBuffers.length > 0;
    if (recorded) {
      const sample = this.context.createBufferSource();
      const sampleGain = this.context.createGain();
      sample.buffer = this.thunderBuffers[Math.floor(Math.random() * this.thunderBuffers.length)];
      sample.playbackRate.value = 0.94 + Math.random() * 0.1;
      sampleGain.gain.value = 0.46 * clamp(intensity, 0.25, 1);
      sample.connect(sampleGain).connect(this.master);
      sample.start(now);
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(260, now);
    filter.frequency.exponentialRampToValueAtTime(58, now + 2.8);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime((recorded ? 0.13 : 0.52) * clamp(intensity, 0.2, 1), now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 3.25);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 3.35);
    for (const [frequency, offset, duration] of [[48, 0, 1.4], [72, 0.18, 0.9]]) {
      const rumble = this.context.createOscillator();
      const rumbleGain = this.context.createGain();
      rumble.type = 'sine';
      rumble.frequency.setValueAtTime(frequency, now + offset);
      rumble.frequency.exponentialRampToValueAtTime(32, now + offset + duration);
      rumbleGain.gain.setValueAtTime((recorded ? 0.07 : 0.18) * intensity, now + offset);
      rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + offset + duration);
      rumble.connect(rumbleGain).connect(this.master);
      rumble.start(now + offset);
      rumble.stop(now + offset + duration + 0.05);
    }
  }

  finish(position = 1) {
    if (!this.ready || this.muted) return;
    const now = this.context.currentTime;
    const notes = position === 1 ? [523.25, 659.25, 783.99, 1046.5] : [392, 493.88, 587.33];
    notes.forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = index === notes.length - 1 ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      const start = now + index * 0.13;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.13, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(start);
      oscillator.stop(start + 0.58);
    });
  }

  ui(frequency = 650) {
    if (!this.ready || this.muted) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.3, now + 0.07);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.1);
  }

  setPaused(paused) {
    this.paused = paused;
    if (!this.ready) return;
    const now = this.context.currentTime;
    this.engineGains.forEach((gain) => gain.gain.setTargetAtTime(0, now, 0.035));
    this.roadGain.gain.setTargetAtTime(0, now, 0.035);
    this.tyreGain.gain.setTargetAtTime(active * (car.slip || 0) * 0.08, now, 0.08);
    this.nitroGain.gain.setTargetAtTime(0, now, 0.035);
    this.rivalGain?.gain.setTargetAtTime(0, now, 0.035);
    this.weatherGain?.gain.setTargetAtTime(0, now, 0.12);
    this.recordedRainGain?.gain.setTargetAtTime(0, now, 0.16);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.72, this.context.currentTime, 0.03);
    if (this.muteButton) {
      this.muteButton.textContent = this.muted ? '🔇' : '🔊';
      this.muteButton.setAttribute('aria-label', this.muted ? 'Unmute game audio' : 'Mute game audio');
    }
  }
}
