import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { integrateHandling } from '../src/physics.js';
import { rigWheel, animateWheel } from '../src/wheels.js';
import { sampleGhost, validGhost, GhostTrial } from '../src/ghost.js';

test('wheel steering preserves its axle through rolling and restarts',()=>{
  const parent=new THREE.Group(),wheel=new THREE.Group(); parent.add(wheel);
  wheel.position.set(0.8,0.36,-1.15);wheel.rotation.x=-Math.PI/2;
  const brake=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());brake.name='brake';wheel.add(brake);
  const rig=rigWheel(wheel,true);
  animateWheel(rig,40,0.2,3);
  const axle=new THREE.Vector3(1,0,0).applyQuaternion(wheel.quaternion);
  assert.ok(axle.distanceTo(new THREE.Vector3(1,0,0))<1e-8);
  assert.equal(brake.parent,rig.pivot);
  assert.deepEqual(rig.pivot.position.toArray(),[0.8,0.36,-1.15]);
  rig.angle=0;animateWheel(rig,0,0,0);assert.ok(wheel.quaternion.angleTo(rig.base)<1e-8);
});
test('handbrake builds slip and counter-steering recovers grip',()=>{
  const car={speed:40,x:0,lateralVelocity:0,steerAngle:0,nitroAmount:1};
  for(let i=0;i<45;i++)integrateHandling(car,{throttle:true,steer:0.7,handbrake:true},1/120);
  assert.ok(car.drift>0.8 && car.isDrifting);
  const drift=car.drift;
  for(let i=0;i<60;i++)integrateHandling(car,{throttle:true,steer:-0.3},1/120);
  assert.ok(car.drift<drift*0.5);
  for(let i=0;i<240;i++)integrateHandling(car,{throttle:true,steer:0},1/120);
  assert.ok(car.slip<0.1);
});
test('ghost interpolates and rejects corrupt or incompatible recordings',()=>{
  const samples=[[0,0,0,0,0,0,0],[2,2,0,-40,0,0,0]];
  assert.equal(sampleGhost(samples,1)[3],-20);
  assert.equal(sampleGhost(samples,3),null);
  assert.equal(validGhost({version:3,time:2,samples}),true);
  assert.equal(validGhost({version:2,time:2,samples}),false);
  assert.equal(validGhost({version:3,time:2,samples:[samples[1],samples[0]]}),false);
});
test('a slower trial does not overwrite the best; storage failure does not break finish',()=>{
  const trial=new GhostTrial(new THREE.Scene());
  const car={group:new THREE.Group()};
  trial.samples=[[0,0,0,0,0,0,0]];
  trial.best={version:3,time:5,samples:[[0,0,0,0,0,0,0],[5,0,0,-6000,0,0,0]]};
  assert.equal(trial.finish(6,car).isRecord,false);assert.equal(trial.best.time,5);
  trial.samples=[[0,0,0,0,0,0,0]];
  const result=trial.finish(4,car);assert.equal(result.isRecord,true);assert.equal(result.saved,false);
});
