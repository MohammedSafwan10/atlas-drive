import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { integrateHandling, FixedStepper } from '../src/physics.js';
import { Landscape } from '../src/landscape.js';
import { Traffic } from '../src/traffic.js';
const fresh = () => ({ speed: 0, x: 0, lateralVelocity: 0, steerAngle: 0, nitroAmount: 1, airborne: false });
const gas = { throttle: true, steer: 0 };
function drive(fps) {
  const car = fresh(), stepper = new FixedStepper();
  let distance = 0, time = 0;
  for (let frame = 0; frame < fps * 12; frame++) stepper.advance(1 / fps, dt => {
    integrateHandling(car, { ...gas, steer: time > 3 && time < 3.5 ? 0.6 : 0 }, dt);
    distance += car.speed * dt; time += dt;
  });
  return { speed: car.speed, distance, x: car.x };
}
test('30, 60 and 144 Hz produce the same trajectory', () => {
  const baseline = drive(60);
  for (const fps of [20,30,144]) for (const key of Object.keys(baseline)) assert.ok(Math.abs(drive(fps)[key]-baseline[key]) < 1e-7, `${fps}Hz ${key}`);
});
test('normal engine reaches useful race speed', () => { assert.ok(drive(60).speed > 65); });
test('releasing nitro preserves momentum above the normal limiter', () => {
  const car = { ...fresh(), speed: 85 };
  integrateHandling(car, gas, 1/120);
  assert.ok(car.speed > 84.8 && car.speed < 85);
});
test('brakes override throttle and nitro; wet braking takes longer', () => {
  const dry = { ...fresh(), speed: 65 }, wet = { ...dry };
  for (let i=0;i<120;i++) {
    const input = { ...gas, brake: true, nitro: true };
    integrateHandling(dry,input,1/120,0,0); integrateHandling(wet,input,1/120,0,1);
  }
  assert.ok(dry.speed < wet.speed && wet.speed < 65);
  assert.equal(dry.nitroActive,false);
});
test('stationary steering cannot slide the car and airborne throttle adds no thrust', () => {
  const stopped = fresh(); integrateHandling(stopped,{steer:1},1/120); assert.equal(stopped.x,0);
  const flying = {...fresh(),airborne:true,speed:45,lateralVelocity:2};
  integrateHandling(flying,{...gas,steer:-1,nitro:true},1/120);
  assert.equal(flying.lateralVelocity,2); assert.ok(flying.speed < 45); assert.equal(flying.nitroActive,false);
});
test('long steering inputs remain bounded and brake reaches a stop', () => {
  const car = {...fresh(),speed:70};
  for(let i=0;i<1200;i++) integrateHandling(car,{...gas,steer:1},1/120,0.001,1);
  assert.ok(Math.abs(car.x)<=5.15 && Number.isFinite(car.speed));
  for(let i=0;i<1200;i++) integrateHandling(car,{brake:true,steer:0},1/120);
  assert.equal(car.speed,0);
});
test('fixed-step catch-up is bounded and reset drops stale time', () => {
  const stepper = new FixedStepper(); let steps=0;
  stepper.advance(10,()=>steps++); assert.equal(steps,30);
  stepper.advance(0.001,()=>{}); stepper.reset(); assert.equal(stepper.accumulator,0);
});
test('mountains have upward normals, shared seams and stable recycled chunks', () => {
  const landscape = new Landscape(new THREE.Scene());
  for(const mesh of landscape.chunks) {
    const normal = mesh.geometry.attributes.normal;
    for(let i=0;i<normal.count;i++) assert.ok(normal.getY(i)>0);
  }
  const left = landscape.chunks.find(m=>m.userData.side===1 && m.userData.startZ===0);
  const next = landscape.chunks.find(m=>m.userData.side===1 && m.userData.startZ===-400);
  for(let c=0;c<10;c++) for(const axis of ['X','Y']) assert.equal(left.geometry.attributes.position[`get${axis}`](200+c), next.geometry.attributes.position[`get${axis}`](c));
  const positions = left.geometry.attributes.position.array.slice();
  landscape.update(-450);
  assert.deepEqual(left.geometry.attributes.position.array,positions);
});
test('finished rivals retain their finishing order even after rolling forward', () => {
  const fake = {cars:[{z:-6100,finishTime:95},{z:-6250,finishTime:98},{z:-5900,finishTime:null}]};
  const standings = Traffic.prototype.getRaceStandings.call(fake,-6000,97);
  assert.deepEqual(standings.map(x=>x.name),['APEX','YOU','VOLT','NOVA']);
});

test('race collision respects vertical separation and returns after landing', () => {
  const traffic = Object.create(Traffic.prototype);
  traffic.cars = Array.from({length:3},()=>({mesh:new THREE.Group(),halfW:0.9,halfL:2.1}));
  traffic.resetRace('normal');
  for(let i=1;i<3;i++) traffic.cars[i].mesh.visible=false;
  const rival=traffic.cars[0];
  rival.x=0; rival.z=0; rival.targetX=0; rival.targetLane=1;
  const player={x:0,z:0,speed:0,group:new THREE.Group()};
  player.group.position.y=8;
  let hits=0;
  traffic.updateRace(1/120,player,true,()=>hits++);
  assert.equal(hits,0);
  player.group.position.y=rival.mesh.position.y;
  traffic.updateRace(1/120,player,true,()=>hits++);
  assert.equal(hits,1);
});
