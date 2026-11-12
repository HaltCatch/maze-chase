import { schema, t } from '@colyseus/schema';
import { Pose } from './movement.ts';
/** Public room state. Visibility-filtered combat snapshots travel as typed room messages. */
export const RoomState = schema(
  {
    phase: t.string().default('lobby'),
    revision: t.uint32().default(0),
    humans: t.uint8().default(0),
    capacity: t.uint8().default(2),
    mode: t.string(),
    arena: t.string(),
    poses: t.map(Pose).view(),
  },
  'RoomState',
);
export type RoomOptions = {
  mode: string;
  arena?: string;
  difficulty?: string;
  blackout?: boolean;
  maxPlayers?: number;
  aiCount?: number;
  doubleJump?: boolean;
  allowClimb?: boolean;
  airJumpHeight?: number;
  name?: string;
  customMap?: unknown;
};
