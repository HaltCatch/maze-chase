const modes = ['parkour', 'escape', 'practice', 'duel', 'skirmish', 'gungame', 'survival'] as const;
export type GameMode = (typeof modes)[number];
export function isGameMode(value: unknown): value is GameMode {
  return modes.some((mode) => mode === value);
}

const clientTypes = [
  'hello',
  'leave',
  'assets-ready',
  'scene-ready',
  'client-error',
  'create',
  'join',
  'deployment',
  'start',
  'input',
  'action',
  'jump',
  'light',
  'decoy',
  'parkour-use',
  'weapon-ready',
  'weapon-fire',
  'weapon-cancel',
  'weapon-reload',
  'weapon-select',
] as const;
type ClientType = (typeof clientTypes)[number];
const allowed = new Set<unknown>(clientTypes);
type ClientPacket = { type: ClientType } & Record<string, unknown>;

/** Parse the untrusted envelope. Each game action still validates its own fields. */
export function decodeClientPacket(raw: string): ClientPacket | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('type' in value) ||
    !allowed.has(value.type)
  )
    return null;
  return value as ClientPacket;
}

const inputKeys = ['f', 'b', 'l', 'r', 'run', 'quiet'] as const;
export type Movement = Record<(typeof inputKeys)[number], boolean> & {
  moveX: number;
  moveZ: number;
};
export function readMovement(input: Record<string, unknown>): Movement {
  const [f, b, l, r, run, quiet] = inputKeys.map((key) => input[key] === true);
  const axis = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(-1, Math.min(1, value))
      : fallback;
  const moveX = axis(input.moveX, +r - +l),
    moveZ = axis(input.moveZ, +f - +b);
  return { f: moveZ > 0, b: moveZ < 0, l: moveX < 0, r: moveX > 0, run, quiet, moveX, moveZ };
}
