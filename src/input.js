// Keyboard input state
export class Input {
  constructor() {
    this.keys = new Set();
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  get throttle() { return this.keys.has('KeyW') || this.keys.has('ArrowUp'); }
  get brake() { return this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.keys.has('Space'); }
  get nitro() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }
  get steer() {
    let s = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    return s;
  }
}
