import {expect,it} from 'vitest';
import * as THREE from 'three';
import {projectParticleParts} from '../src/adapters/displayed-part-projection';
import {frameBody,fitCamera} from '../src/adapters/three-renderer';
function matrix(camera:THREE.PerspectiveCamera, model=new THREE.Matrix4()){camera.updateMatrixWorld();return camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).multiply(model);}
it('projects actual grouped positions using full model and camera transforms',()=>{
 const camera=new THREE.PerspectiveCamera(60,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
 const positions=new Float32Array([0,0,0,1,0,0,0,1,0]);const transform=new THREE.Matrix4().makeTranslation(.4,-.2,0);
 const parts=projectParticleParts(positions,3,new Uint8Array([0,0,1]),['left','top'],matrix(camera,transform));
 const p=new THREE.Vector3(.4,-.2,0).project(camera),q=new THREE.Vector3(1.4,-.2,0).project(camera);
 expect(parts[0].centroid!.x).toBeCloseTo(((p.x+1)/2+(q.x+1)/2)/2);
 expect(parts[1].centroid!.y).toBeLessThan(parts[0].centroid!.y);
});
it('uses post-framing samples rather than raw DSL coordinates',()=>{
 const camera=new THREE.PerspectiveCamera(42,1,.1,100);fitCamera(camera,1);
 const positions=new Float32Array([100,20,0,101,20,0]);const fit=frameBody(positions,2,camera);
 expect(fit).toBeLessThan(1);const actual=projectParticleParts(positions,2,new Uint8Array([0,0]),['part'],matrix(camera));
 expect(actual[0].visibleParticles).toBe(2);expect(actual[0].centroid!.x).toBeLessThan(1);
});
it('responds to movement and resize with normalized bounds',()=>{
 const camera=new THREE.PerspectiveCamera(42,1,.1,100);fitCamera(camera,1);
 const groups=new Uint8Array([0,0]),positions=new Float32Array([-.2,0,0,.2,0,0]);
 const before=projectParticleParts(positions,2,groups,['p'],matrix(camera))[0];positions[0]+=.5;positions[3]+=.5;
 const moved=projectParticleParts(positions,2,groups,['p'],matrix(camera))[0];expect(moved.centroid!.x).toBeGreaterThan(before.centroid!.x);
 fitCamera(camera,2);const resized=projectParticleParts(positions,2,groups,['p'],matrix(camera))[0];expect(resized.centroid!.x).not.toBe(moved.centroid!.x);
 expect(resized.bounds!.min.x).toBeGreaterThanOrEqual(0);expect(resized.bounds!.max.x).toBeLessThanOrEqual(1);
});
it('hides behind-camera, clipped, missing and nonfinite particle groups',()=>{
 const camera=new THREE.PerspectiveCamera(60,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
 const parts=projectParticleParts(new Float32Array([0,0,6,999,0,0,NaN,0,0,0,0,0]),4,new Uint8Array([0,0,0,9]),['hidden','empty'],matrix(camera));
 expect(parts[0]).toMatchObject({particles:3,visibleParticles:0,centroid:null,bounds:null});expect(parts[1].centroid).toBeNull();
});
