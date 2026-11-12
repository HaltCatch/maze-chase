import { Engine, Scene, Vector3, Color3, Color4, FreeCamera, HemisphericLight, MeshBuilder, StandardMaterial } from '../engine/babylon.ts';
import { PhysicsWorld, initPhysics } from '../engine/physics.ts';
import { stepMovement } from '../network/movement.ts';
import { Parkour, type Runner } from '../server/modes/parkour.ts';
import { parkourMaps } from '../content/parkour-maps.ts';

const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
const status = document.querySelector<HTMLElement>('#status')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const start = document.querySelector<HTMLButtonElement>('#start')!;
const choose = document.querySelector<HTMLSelectElement>('#course')!;
const engine = new Engine(canvas, true);
let scene: Scene, world: PhysicsWorld, course: Parkour, body: Runner, camera: FreeCamera;
let jump = 0, pitch = 0, active = false, elapsed = 0, accumulator = 0;
let coins: {id: string; mesh: ReturnType<typeof MeshBuilder.CreateSphere>}[] = [];
const held = new Set<string>();
function material(name: string, color: string, glow = false) {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(color);
  if (glow) m.emissiveColor = m.diffuseColor.scale(0.65);
  return m;
}
async function load() {
  active = false;
  held.clear();
  start.disabled = true;
  start.textContent = '载入物理引擎…';
  world?.dispose();
  scene?.dispose();
  scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.025, 0.045, 0.09, 1);
  new HemisphericLight('sky', new Vector3(0,1,0), scene).intensity = 1.25;
  course = new Parkour(parkourMaps[choose.value], choose.value);
  const wasm = new Uint8Array(await (await fetch('./engine/havok.wasm')).arrayBuffer());
  world = new PhysicsWorld(course.map, await initPhysics(wasm));
  body = {id:'local', name:'You', ...course.map.spawn!, vx:0, vy:0, vz:0, yaw:-Math.PI/2,
    energy:1, exhausted:false, recovery:0, jumpAck:0, maxJumps:2, airJumpHeight:1,
    input:{f:false,b:false,l:false,r:false,run:false,quiet:false}};
  jump = pitch = elapsed = accumulator = 0;
  for (const c of course.map.colliders) {
    const mesh = MeshBuilder.CreateBox(c.id, {width:c.width,height:c.height,depth:c.depth}, scene);
    mesh.position.set(c.x,c.y,c.z);
    mesh.material = material(c.id, c.surface === 'oxide' ? '#b86b47' : '#42698c');
  }
  for (const [i,c] of course.map.checkpoints!.entries()) {
    const ring = MeshBuilder.CreateTorus('checkpoint'+i,{diameter:1.6,thickness:0.08,tessellation:40},scene);
    ring.position.set(c.x,c.y+0.08,c.z);
    ring.material = material('checkpoint'+i,i===course.map.checkpoints!.length-1?'#baff74':'#50d9ec',true);
  }
  coins = (course.map.collectibles ?? []).map(c => {
    const mesh = MeshBuilder.CreateSphere(c.id,{diameter:0.42,segments:12},scene);
    mesh.position.set(c.x,c.y,c.z);
    mesh.material = material(c.id,'#ffd15c',true);
    return {id:c.id,mesh};
  });
  camera = new FreeCamera('player',new Vector3(body.x,body.y+1.16,body.z),scene);
  camera.inputs.clear(); camera.minZ=0.05; camera.fov=1.15;
  start.disabled = false; start.textContent = '开始跑酷 / Play';
  overlay.hidden = false;
}
start.onclick = async () => {
  active = true;
  overlay.hidden = true;
  course.started = Date.now()-elapsed*1000;
  try { await canvas.requestPointerLock(); } catch { status.textContent='按住鼠标拖动视角；WASD 移动，空格跳跃。'; }
  canvas.focus();
};
choose.onchange = () => void load().catch(fail);
document.querySelector<HTMLButtonElement>('#restart')!.onclick = () => void load().catch(fail);
window.addEventListener('keydown',e=>{
  if (['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','Escape'].includes(e.code)) e.preventDefault();
  if(e.code==='Escape'){active=false;overlay.hidden=false;document.exitPointerLock();held.clear();}
  if(active && e.code==='Space' && !e.repeat) jump++;
  held.add(e.code);
});
window.addEventListener('keyup',e=>held.delete(e.code));
window.addEventListener('blur',()=>{active=false;held.clear();overlay.hidden=false;});
document.addEventListener('visibilitychange',()=>{if(document.hidden){active=false;held.clear();overlay.hidden=false;}});
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement){active=false;held.clear();overlay.hidden=false;}});
canvas.addEventListener('mousemove',e=>{
  if(active && (document.pointerLockElement===canvas || e.buttons===1)){
    body.yaw-=e.movementX*0.0025;
    pitch=Math.max(-1.45,Math.min(1.45,pitch-e.movementY*0.0025));
  }
});
window.addEventListener('resize',()=>engine.resize());
function fail(error: unknown){status.textContent='载入失败，请刷新重试。';start.textContent='重试';start.disabled=false;start.onclick=()=>void load().catch(fail);console.error(error);}
engine.runRenderLoop(()=>{
  if(!body || !world) return;
  const dt=Math.min(engine.getDeltaTime()/1000,0.05);
  if(active && !body.finishedAt){
    elapsed+=dt; accumulator+=dt;
    while(accumulator>=1/60){
      stepMovement(body,{moveX:Number(held.has('KeyD'))-Number(held.has('KeyA')),moveZ:Number(held.has('KeyW'))-Number(held.has('KeyS')),run:held.has('ShiftLeft'),quiet:false,yaw:body.yaw,jump},world,1/60);
      course.tick(body,course.started+elapsed*1000);
      accumulator-=1/60;
    }
  }
  camera.position.set(body.x,body.y+1.16,body.z);
  camera.rotation.set(pitch,body.yaw,0);
  for(const c of coins)c.mesh.setEnabled(!body.collected?.has(c.id));
  status.textContent=`${elapsed.toFixed(1)}s · 金币 ${body.collected?.size??0}/${coins.length} · 检查点 ${body.checkpoint??0}/${course.map.checkpoints!.length} · 跌落 ${body.falls??0}`;
  if(body.finishedAt){active=false;status.textContent='完成！ '+status.textContent;document.exitPointerLock();overlay.hidden=false;start.textContent='重新挑战';start.onclick=()=>void load().then(()=>start.click()).catch(fail);}
  scene.render();
});
void load().catch(fail);
