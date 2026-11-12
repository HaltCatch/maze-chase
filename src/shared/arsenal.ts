type WeaponBase = { label: string; ammo: number; cooldown: number; port?: boolean };
type WeaponSpec = WeaponBase &
  (
    | {
        projectile: 'bullet';
        reserve: number;
        maxReserve: number;
        pickup: number;
        reload: number;
        damage: number;
        range: number;
        auto?: boolean;
        scope?: boolean;
      }
    | {
        projectile: 'arrow';
        speed: number;
        gravity: number;
        life: number;
        charge: number;
        stun: number;
      }
    | {
        projectile: 'shell' | 'grenade';
        speed: number;
        gravity: number;
        life: number;
        radius?: number;
        damage?: number;
        stun?: number;
      }
  );

export const weapons = Object.freeze({
  bow: {
    projectile: 'arrow',
    label: '猎弓',
    ammo: 8,
    cooldown: 420,
    speed: 30,
    gravity: 9.81,
    life: 2.4,
    charge: 720,
    stun: 540,
  },
  cannon: {
    projectile: 'shell',
    label: '手持火炮',
    ammo: 2,
    cooldown: 1450,
    speed: 14,
    gravity: 2.2,
    life: 2.5,
    radius: 2.65,
    stun: 1080,
  },
  rifle: {
    projectile: 'bullet',
    label: 'AK-47',
    ammo: 30,
    reserve: 120,
    maxReserve: 180,
    pickup: 45,
    reload: 1800,
    cooldown: 108,
    damage: 24,
    range: 39,
    auto: true,
    port: true,
  },
  pistol: {
    projectile: 'bullet',
    label: 'M1911',
    ammo: 7,
    reserve: 28,
    maxReserve: 42,
    pickup: 14,
    reload: 1200,
    cooldown: 235,
    damage: 19,
    range: 27,
    port: true,
  },
  sniper: {
    projectile: 'bullet',
    label: 'M24',
    ammo: 5,
    reserve: 15,
    maxReserve: 25,
    pickup: 5,
    reload: 2350,
    cooldown: 1160,
    damage: 76,
    range: 52,
    scope: true,
    port: true,
  },
  frag: {
    projectile: 'grenade',
    label: '破片手雷',
    ammo: 2,
    cooldown: 950,
    speed: 8.4,
    gravity: 13,
    life: 1.55,
    radius: 3.3,
    damage: 125,
    port: true,
  },
  smoke: {
    projectile: 'grenade',
    label: '烟雾弹',
    ammo: 1,
    cooldown: 950,
    speed: 8,
    gravity: 13,
    life: 1.35,
    port: true,
  },
  flash: {
    projectile: 'grenade',
    label: '闪光弹',
    ammo: 1,
    cooldown: 900,
    speed: 7.5,
    gravity: 13,
    life: 1.15,
    radius: 4.3,
    stun: 1750,
  },
} satisfies Record<string, WeaponSpec>);
export type WeaponId = keyof typeof weapons;

export const characters = Object.freeze({
  operator: '干员',
  rogue: '轻装游侠',
  knight: '小骑士',
  mage: '紫袍法师',
  barbarian: '荒野战士',
  ranger: '兜帽游侠',
});
export const primaries = Object.freeze(['rifle', 'sniper'] as const);
export const throwables = Object.freeze(['flash', 'frag', 'smoke'] as const);
export type CharacterId = keyof typeof characters;
export type Primary = (typeof primaries)[number];
export type Throwable = (typeof throwables)[number];
export type Loadout = { character: CharacterId; primary?: Primary; throwable?: Throwable };
type LoadoutChoice = { character?: unknown; primary?: unknown; throwable?: unknown };
export const harborMode = (mode: unknown): mode is 'duel' | 'skirmish' | 'gungame' | 'survival' =>
  ['duel', 'skirmish', 'gungame', 'survival'].includes(String(mode));
const listed = <T extends string>(options: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && options.some((option) => option === value);
function isCharacter(value: unknown): value is CharacterId {
  return typeof value === 'string' && Object.hasOwn(characters, value);
}
export function deployment(mode: unknown, choice?: LoadoutChoice | null): Loadout {
  const character = isCharacter(choice?.character) ? choice.character : 'ranger';
  if (!harborMode(mode)) return { character };
  const primary = listed(primaries, choice?.primary) ? choice.primary : 'rifle';
  const throwable = listed(throwables, choice?.throwable) ? choice.throwable : 'flash';
  return { character, primary, throwable };
}

export const weaponSounds = {
  bow: { draw: 'draw', launch: 'release', impact: 'arrow-hit', land: 'flash-bounce' },
  cannon: { launch: 'cannon-shot', burst: 'cannon-burst' },
  rifle: { launch: 'ak-shot', reload: 'mag-change' },
  pistol: { launch: 'pistol-shot', reload: 'mag-change' },
  sniper: { launch: 'sniper-shot', reload: 'bolt-load' },
  frag: { bounce: 'flash-bounce', burst: 'cannon-burst' },
  smoke: { bounce: 'flash-bounce', deploy: 'smoke-hiss' },
  flash: { bounce: 'flash-bounce', burst: 'flash-bang' },
};

export const smokeDuration = 14500;
export function smokeShape(age: number) {
  const grow = Math.max(0, Math.min(1, age / 1100));
  const fade = Math.max(0, Math.min(1, (smokeDuration - age) / 2600));
  return { radius: 0.25 + 2.75 * Math.sqrt(grow), density: grow * fade };
}

// Camera-local metres. The source model's string anchors are behind its grip.
export const arrowLength = 0.5;
export const bowMinDraw = 120;
export const maxEmbeddedArrows = 32;
export function bowLine(draw: number) {
  const nock = [-0.085 + 0.016 * draw, -0.101, -0.46 + 0.165 * draw];
  const aim = [-nock[0], -nock[1], -5 - nock[2]];
  const distance = Math.hypot(...aim);
  return { nock, aim: aim.map((component) => component / distance) };
}

export const harborBody = Object.freeze({
  standing: { height: 1.75, eye: 1.55, head: 1.6 },
  crouching: { height: 1.27, eye: 1.1, head: 1.15 },
  radius: 0.26,
});

const adventurerCrouch = Object.freeze({ height: 1.64, eye: 1.4, head: 1.5 });
export function characterPosture(character: string | undefined, quiet: boolean) {
  if (!quiet) return harborBody.standing;
  return ['knight', 'rogue', 'mage', 'barbarian', 'ranger'].includes(character ?? '')
    ? adventurerCrouch
    : harborBody.crouching;
}
