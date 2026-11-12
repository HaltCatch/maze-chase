import { Predict, type Room } from '@colyseus/sdk';
import { MoveInput, readPose, stepMovement, type Locomotion } from '../../network/movement.ts';
import type { RoomState } from '../../network/state.ts';
import type { PhysicsWorld } from '../../engine/physics.ts';
import type { Movement } from '../../shared/protocol.ts';
export function createPrediction(
  room: Room<unknown, InstanceType<typeof RoomState>>,
  body: Locomotion,
  physics: PhysicsWorld,
) {
  const input = room.input({ type: MoveInput, mode: 'reliable' }),
    predict = Predict.get(room, { mode: 'lerp', delay: 100 });
  const controller = predict.sim({
    input,
    world: { body, physics },
    smoothMs: 65,
    adopt: (w) => {
      const pose = room.state.poses.get(room.sessionId);
      if (pose) readPose(w.body, pose);
    },
    step: (ctx, w, cmd) => stepMovement(w.body, cmd, w.physics, ctx.dt),
    pose: (w) => ({ x: w.body.x, y: w.body.y, z: w.body.z }),
  });
  return {
    frame(now: number, movement: Movement, yaw: number, jump: number) {
      const count = predict.tick(now);
      for (let i = 0; i < count; i++) {
        Object.assign(input.data, {
          moveX: movement.moveX,
          moveZ: movement.moveZ,
          quiet: movement.quiet,
          run: movement.run,
          yaw,
          jump,
        });
        input.send();
      }
      return controller.pose();
    },
    dispose() {
      controller.dispose();
      predict.dispose();
    },
  };
}
