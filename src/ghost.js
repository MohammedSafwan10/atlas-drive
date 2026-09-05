import * as THREE from 'three';
export const GHOST_KEY = 'atlas-drive-trial-v3-clear';
export function sampleGhost(samples, time) {
  if (!samples.length || time > samples.at(-1)[0]) return null;
  let lo = 0, hi = samples.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (samples[mid][0] <= time) lo = mid; else hi = mid; }
  const a = samples[lo], b = samples[hi];
  const f = Math.max(0, Math.min(1, (time - a[0]) / Math.max(1e-6, b[0] - a[0])));
  return a.map((v,i)=>v+(b[i]-v)*f);
}
export function validGhost(value) {
  return value?.version === 3 && Number.isFinite(value.time) && value.time > 0 && value.time <= 600 &&
    Array.isArray(value.samples) && value.samples.length >= 2 && value.samples.length <= 12002 &&
    value.samples.every((s,i,all)=>Array.isArray(s) && s.length===7 && s.every(Number.isFinite) && s[0]>=0 && (i===0 || s[0]>all[i-1][0])) &&
    Math.abs(value.samples.at(-1)[0]-value.time)<0.001;
}
export class GhostTrial {
  constructor(scene) { this.scene=scene; this.best=null; this.mesh=null; this.samples=[]; this.nextSample=0; this.storageOK=true; }
  load() {
    this.best=null;
    try { const value=JSON.parse(localStorage.getItem(GHOST_KEY)); if(validGhost(value)) this.best=value; }
    catch { /* corrupt or unavailable local record is optional */ }
  }
  start(car) {
    this.load(); this.samples=[]; this.nextSample=0;
    if (!this.mesh) {
      this.mesh=car.group.clone(true);
      const remove=[];
      this.mesh.traverse(o=>{ if(o.isLight) remove.push(o); if(o.isMesh) {
        o.material=new THREE.MeshBasicMaterial({color:0x55dfff,transparent:true,opacity:0.23,depthWrite:false});
        o.castShadow=o.receiveShadow=false;
      }});
      remove.forEach(o=>o.removeFromParent()); this.scene.add(this.mesh);
    }
    this.mesh.visible=Boolean(this.best);
    this.record(0,car,true);
  }
  record(time,car,force=false) {
    if(time>600 || (!force && time<this.nextSample)) return;
    const p=car.group.position,r=car.group.rotation;
    const sample=[time,p.x,p.y,p.z,r.x,r.y,r.z];
    if(this.samples.length && time<=this.samples.at(-1)[0]) this.samples[this.samples.length-1]=sample;
    else this.samples.push(sample);
    this.nextSample=time+0.05;
  }
  update(time) {
    const s=this.best && sampleGhost(this.best.samples,time);
    if(this.mesh) {this.mesh.visible=Boolean(s); if(s){this.mesh.position.set(s[1],s[2],s[3]);this.mesh.rotation.set(s[4],s[5],s[6]);}}
  }
  finish(time,car) {
    this.record(time,car,true);
    const isRecord=!this.best || time<this.best.time;
    let saved=false;
    if(isRecord && time<=600) {
      const value={version:3,time,samples:this.samples};
      if(validGhost(value)) {this.best=value;try{localStorage.setItem(GHOST_KEY,JSON.stringify(value));saved=true;}catch{this.storageOK=false;}}
    }
    this.hide(); return {isRecord,bestTime:this.best?.time || time,saved};
  }
  hide(){if(this.mesh)this.mesh.visible=false;}
}
