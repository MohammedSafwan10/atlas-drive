import * as THREE from 'three';

export const TIME_MODES = ['auto', 'morning', 'day', 'sunset', 'night'];
export const TIME_MODE_LABELS = {
  auto: 'AUTO', morning: 'MORNING', day: 'DAY', sunset: 'SUNSET', night: 'NIGHT',
};

const MODE_PHASES = { morning: 0.285, day: 0.5, sunset: 0.73, night: 0.94 };
const CYCLE_SECONDS = 480;

const STOPS = [
  { phase: 0, label: 'NIGHT', icon: '☾', weights: [0, 0, 1], sun: 0.22, hemi: 0.085, environment: 0.22, exposure: 0.56, fogDensity: 0.0031, fog: 0x152138, sunColor: 0x9bbcff, skyColor: 0x263b62, groundColor: 0x111a15 },
  { phase: 0.19, label: 'PRE-DAWN', icon: '☾', weights: [0.08, 0.12, 0.8], sun: 0.28, hemi: 0.11, environment: 0.27, exposure: 0.61, fogDensity: 0.003, fog: 0x35445f, sunColor: 0xffaf7e, skyColor: 0x536786, groundColor: 0x20251f },
  { phase: 0.285, label: 'MORNING', icon: '◒', weights: [0.78, 0.22, 0], sun: 1.55, hemi: 0.2, environment: 0.58, exposure: 0.78, fogDensity: 0.0027, fog: 0xc3b5aa, sunColor: 0xffc589, skyColor: 0xa9c4dc, groundColor: 0x4e4b38 },
  { phase: 0.5, label: 'DAY', icon: '☀', weights: [1, 0, 0], sun: 2.2, hemi: 0.25, environment: 1, exposure: 0.9, fogDensity: 0.00235, fog: 0xb9cad6, sunColor: 0xfff0d5, skyColor: 0xbdd4ea, groundColor: 0x424b37 },
  { phase: 0.65, label: 'AFTERNOON', icon: '☀', weights: [0.72, 0.28, 0], sun: 1.85, hemi: 0.2, environment: 0.62, exposure: 0.82, fogDensity: 0.00245, fog: 0xcbbcac, sunColor: 0xffd09b, skyColor: 0xbac7d3, groundColor: 0x544b38 },
  { phase: 0.73, label: 'SUNSET', icon: '◐', weights: [0.05, 0.95, 0], sun: 2.05, hemi: 0.13, environment: 0.18, exposure: 0.72, fogDensity: 0.00275, fog: 0xb47b67, sunColor: 0xff8b46, skyColor: 0xb67876, groundColor: 0x493322 },
  { phase: 0.82, label: 'TWILIGHT', icon: '◒', weights: [0, 0.34, 0.66], sun: 0.38, hemi: 0.09, environment: 0.22, exposure: 0.59, fogDensity: 0.0031, fog: 0x41415b, sunColor: 0xff8a60, skyColor: 0x4b5578, groundColor: 0x191a1b },
  { phase: 1, label: 'NIGHT', icon: '☾', weights: [0, 0, 1], sun: 0.22, hemi: 0.085, environment: 0.22, exposure: 0.56, fogDensity: 0.0031, fog: 0x152138, sunColor: 0x9bbcff, skyColor: 0x263b62, groundColor: 0x111a15 },
];

function lerpColor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

function sampleProfile(phase) {
  let left = STOPS[0];
  let right = STOPS[STOPS.length - 1];
  for (let i = 1; i < STOPS.length; i++) {
    if (phase <= STOPS[i].phase) {
      left = STOPS[i - 1];
      right = STOPS[i];
      break;
    }
  }
  const t = THREE.MathUtils.smoothstep(
    (phase - left.phase) / Math.max(0.0001, right.phase - left.phase), 0, 1,
  );
  const mix = (key) => THREE.MathUtils.lerp(left[key], right[key], t);
  const weights = left.weights.map((value, index) => THREE.MathUtils.lerp(value, right.weights[index], t));
  const night = THREE.MathUtils.clamp(weights[2] + weights[1] * 0.22, 0, 1);
  const sunAngle = (phase - 0.25) * Math.PI * 2;
  return {
    label: t < 0.5 ? left.label : right.label,
    icon: t < 0.5 ? left.icon : right.icon,
    weights,
    night,
    sunIntensity: mix('sun'),
    hemiIntensity: mix('hemi'),
    exposure: mix('exposure'),
    environmentIntensity: mix('environment'),
    fogDensity: mix('fogDensity'),
    fogColor: lerpColor(left.fog, right.fog, t),
    sunColor: lerpColor(left.sunColor, right.sunColor, t),
    skyColor: lerpColor(left.skyColor, right.skyColor, t),
    groundColor: lerpColor(left.groundColor, right.groundColor, t),
    sunDirection: new THREE.Vector3(Math.cos(sunAngle) * 76, Math.max(7, Math.sin(sunAngle) * 82), 36),
  };
}

function blendProfiles(from, to, t) {
  const mix = (key) => THREE.MathUtils.lerp(from[key], to[key], t);
  return {
    label: to.label,
    icon: to.icon,
    weights: from.weights.map((value, index) => THREE.MathUtils.lerp(value, to.weights[index], t)),
    night: mix('night'),
    sunIntensity: mix('sunIntensity'),
    hemiIntensity: mix('hemiIntensity'),
    exposure: mix('exposure'),
    environmentIntensity: mix('environmentIntensity'),
    fogDensity: mix('fogDensity'),
    fogColor: from.fogColor.clone().lerp(to.fogColor, t),
    sunColor: from.sunColor.clone().lerp(to.sunColor, t),
    skyColor: from.skyColor.clone().lerp(to.skyColor, t),
    groundColor: from.groundColor.clone().lerp(to.groundColor, t),
    sunDirection: from.sunDirection.clone().lerp(to.sunDirection, t),
  };
}

export class TimeOfDay {
  constructor(applyProfile) {
    this.applyProfile = applyProfile;
    this.mode = 'auto';
    this.phase = 0.48;
    this.targetPhase = this.phase;
    this.transition = null;
    this.profile = sampleProfile(this.phase);
    this.applyProfile(this.profile);
  }

  setMode(mode) {
    this.mode = TIME_MODES.includes(mode) ? mode : 'auto';
    if (this.mode !== 'auto') {
      this.targetPhase = MODE_PHASES[this.mode];
      this.transition = {
        from: this.profile,
        to: sampleProfile(this.targetPhase),
        elapsed: 0,
        duration: 0.55,
      };
      // AUTO resumes from the selected period instead of an old hidden phase.
      this.phase = this.targetPhase;
    } else {
      this.transition = null;
    }
    try { localStorage.setItem('turbo-time-mode', this.mode); } catch { /* optional preference */ }
  }

  update(dt) {
    if (this.transition) {
      this.transition.elapsed = Math.min(this.transition.duration, this.transition.elapsed + dt);
      const progress = this.transition.elapsed / this.transition.duration;
      const eased = THREE.MathUtils.smoothstep(progress, 0, 1);
      this.profile = blendProfiles(this.transition.from, this.transition.to, eased);
      if (progress >= 1) this.transition = null;
    } else if (this.mode === 'auto') {
      this.phase = (this.phase + dt / CYCLE_SECONDS) % 1;
      this.profile = sampleProfile(this.phase);
    }
    this.applyProfile(this.profile);
    return this.profile;
  }
}
