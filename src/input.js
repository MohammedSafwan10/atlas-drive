const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Keyboard + touch input state
export class Input {
  constructor() {
    this.keys = new Set();
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.clearAll());

    this.touch = { left: false, right: false, gas: false, brake: false, nitro: false };
    this.tiltEnabled = false;
    this.tiltSteer = 0;
    this.orientationHandler = null;

    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (this.isTouch) this.initTouch();
  }

  initTouch() {
    document.body.classList.add('touch');

    const bind = (id, prop) => {
      const el = document.getElementById(id);
      if (!el) return;
      const set = (v) => {
        this.touch[prop] = v;
        el.classList.toggle('active', v);
      };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        set(true);
      });
      el.addEventListener('pointerup', () => set(false));
      el.addEventListener('pointercancel', () => set(false));
      el.addEventListener('lostpointercapture', () => set(false));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };

    bind('t-left', 'left');
    bind('t-right', 'right');
    bind('t-gas', 'gas');
    bind('t-brake', 'brake');
    bind('t-nitro', 'nitro');

    const toggle = document.getElementById('tilt-toggle');
    toggle?.addEventListener('click', () => {
      if (this.tiltEnabled) {
        this.disableTilt();
        toggle.classList.remove('on');
      } else {
        this.enableTilt().then((ok) => toggle.classList.toggle('on', ok));
      }
    });
  }

  async enableTilt() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') return false;
      }
      this.orientationHandler = (e) => this.onTilt(e);
      addEventListener('deviceorientation', this.orientationHandler);
      this.tiltEnabled = true;
      return true;
    } catch {
      return false;
    }
  }

  disableTilt() {
    if (this.orientationHandler) removeEventListener('deviceorientation', this.orientationHandler);
    this.orientationHandler = null;
    this.tiltEnabled = false;
    this.tiltSteer = 0;
  }

  onTilt(e) {
    const angle = screen.orientation ? screen.orientation.angle : (window.orientation || 0);
    let v;
    if (angle === 90) v = e.beta ?? 0;          // landscape, rotated left
    else if (angle === -90 || angle === 270) v = -(e.beta ?? 0); // landscape, rotated right
    else v = e.gamma ?? 0;                       // portrait
    const dead = 4, range = 22;
    this.tiltSteer = Math.abs(v) < dead ? 0 : clamp((Math.abs(v) - dead) / range, 0, 1) * Math.sign(v);
  }

  clearAll() {
    this.keys.clear();
    for (const k of Object.keys(this.touch)) this.touch[k] = false;
  }

  get throttle() { return this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.touch.gas; }
  get brake() {
    return this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.keys.has('Space') || this.touch.brake;
  }
  get nitro() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touch.nitro; }
  get steer() {
    let s = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (s !== 0) return s;

    if (this.touch.left) s -= 1;
    if (this.touch.right) s += 1;
    if (s !== 0) return s;

    return this.tiltEnabled ? this.tiltSteer : 0;
  }
}
