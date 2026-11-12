import { PhysicsWorld } from '../../src/engine/physics.ts';
import { mapFromDocument } from '../../src/content/map-document.ts';
import { stepMovement } from '../../src/network/movement.ts';
import { readMovement } from '../../src/shared/protocol.ts';
export function jumpLink(map, havok, fromId, toId, maxJumps = 1, airJumpHeight = 1) {
  const from = map.colliders.find((c) => c.id === fromId),
    to = map.colliders.find((c) => c.id === toId);
  const a = Math.atan2(to.z - from.z, to.x - from.x),
    dx = Math.cos(a),
    dz = Math.sin(a);
  for (const run of [false, true])
    for (const margin of [0.2, 0.4, 0.7, 1.0, 1.3])
      for (const delay of maxJumps === 2 ? [5, 7, 9] : [99]) {
        const w = new PhysicsWorld(mapFromDocument(map), havok);
        const p = {
          id: 'link',
          x: from.x - dx * 0.7,
          y: from.y + from.height / 2,
          z: from.z - dz * 0.7,
          vx: 0,
          vy: 0,
          vz: 0,
          yaw: 0,
          jumpAck: 0,
          energy: 1,
          recovery: 0,
          exhausted: false,
          input: readMovement({}),
          maxJumps,
          airJumpHeight,
        };
        const idle = { moveX: 0, moveZ: 0, yaw: 0, run: false, quiet: false, jump: 0 };
        try {
          for (let i = 0; i < 4; i++) stepMovement(p, idle, w, 0.05);
          let started = -1;
          for (let i = 0; i < 90; i++) {
            const edge = Math.min(
              Math.abs(dx) > 0.001
                ? (from.width / 2 - (p.x - from.x) * Math.sign(dx)) / Math.abs(dx)
                : Infinity,
              Math.abs(dz) > 0.001
                ? (from.depth / 2 - (p.z - from.z) * Math.sign(dz)) / Math.abs(dz)
                : Infinity,
            );
            if (started < 0 && edge < margin) started = i;
            const jump = started < 0 ? 0 : i - started >= delay ? 2 : 1;
            stepMovement(p, { ...idle, moveX: dx, moveZ: -dz, run, jump }, w, 0.05);
            if (
              started >= 0 &&
              (to.bounce ? p.boosted && p.vy > 8 : p.grounded) &&
              Math.abs(p.y - to.y - to.height / 2) < (to.bounce ? 0.8 : 0.05) &&
              Math.abs(p.x - to.x) < to.width / 2 - 0.15 &&
              Math.abs(p.z - to.z) < to.depth / 2 - 0.15
            )
              return { run, margin, delay };
            if (p.y < from.y - 3) break;
          }
        } finally {
          w.dispose();
        }
      }
  return null;
}
