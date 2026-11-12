import { z } from 'zod';
import { forestLayout } from './forest-layout.ts';
import type { MapDefinition } from './maps.ts';
const coord = z.number().finite().min(0).max(64);
const point = z.object({ x: coord, y: z.number().finite().min(-8).max(64), z: coord });
export const mapDocumentSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z0-9-]{1,32}$/),
    name: z.string().min(1).max(32),
    size: z.number().int().min(12).max(64),
    groundY: z.number().min(-8).max(0).optional(),
    ground: z.boolean(),
    spawn: point,
    spawnYaw: z.number().finite().min(-Math.PI).max(Math.PI).optional(),
    environment: z.enum(['forest']).optional(),
    obstacles: z
      .array(
        point.extend({
          id: z.string().regex(/^[a-z0-9-]{1,40}$/),
          axis: z.enum(['x', 'z']),
          length: z.number().min(1).max(5),
          radius: z.number().min(0.2).max(1),
          period: z.number().min(2).max(10),
          phase: z.number().min(0).max(6.29),
        }),
      )
      .max(12)
      .optional(),
    pickups: z
      .array(
        point.extend({
          id: z.string().regex(/^[a-z0-9-]{1,40}$/),
          kind: z
            .enum(['rocket', 'refill', 'shield', 'double-jump', 'overdrive'])
            .transform((v) => (v === 'overdrive' ? ('shield' as const) : v)),
          ammo: z.number().int().min(1).max(3).optional(),
        }),
      )
      .max(32)
      .optional(),
    collectibles: z
      .array(point.extend({ id: z.string().regex(/^[a-z0-9-]{1,40}$/) }))
      .max(64)
      .optional(),
    checkpoints: z.array(point).min(2).max(24),
    colliders: z
      .array(
        point.extend({
          id: z.string().regex(/^[a-z0-9-]{1,40}$/),
          width: z.number().min(0.25).max(32),
          height: z.number().min(0.2).max(16),
          depth: z.number().min(0.25).max(32),
          surface: z.enum(['steel', 'oxide', 'olive', 'concrete', 'brick', 'wood']),
          climbable: z.boolean(),
          ramp: z.enum(['positive-z', 'negative-z']).optional(),
          model: z.enum(['ascent-stairs', 'ascent-bridge', 'ascent-bounce']).optional(),
          bounce: z.number().min(6).max(12).optional(),
          shape: z.literal('sphere').optional(),
        }),
      )
      .min(2)
      .max(128),
  })
  .superRefine((map, ctx) => {
    if (new Set(map.colliders.map((c) => c.id)).size !== map.colliders.length)
      ctx.addIssue({ code: 'custom', message: '物件编号必须唯一' });
    if (
      map.colliders.some(
        (c) =>
          c.x - c.width / 2 < 0 ||
          c.z - c.depth / 2 < 0 ||
          c.x + c.width / 2 > map.size ||
          c.z + c.depth / 2 > map.size,
      )
    )
      ctx.addIssue({ code: 'custom', message: '平台必须完整位于地图边界内' });
    if (new Set(map.collectibles?.map((c) => c.id)).size !== (map.collectibles?.length ?? 0))
      ctx.addIssue({ code: 'custom', message: '收集物编号必须唯一' });
    if (new Set(map.obstacles?.map((c) => c.id)).size !== (map.obstacles?.length ?? 0))
      ctx.addIssue({ code: 'custom', message: '障碍编号必须唯一' });
    if (new Set(map.pickups?.map((c) => c.id)).size !== (map.pickups?.length ?? 0))
      ctx.addIssue({ code: 'custom', message: '道具编号必须唯一' });
    for (const p of [...(map.collectibles ?? []), ...(map.pickups ?? [])])
      if (p.x >= map.size || p.z >= map.size)
        ctx.addIssue({ code: 'custom', message: '收集物必须位于地图内' });
    if (
      map.colliders.some(
        (c) =>
          c.shape === 'sphere' &&
          (Math.abs(c.width - c.height) > 0.001 || Math.abs(c.width - c.depth) > 0.001),
      )
    )
      ctx.addIssue({ code: 'custom', message: '球形弹跳物的长宽高必须一致' });
    if (map.colliders.some((c) => c.model === 'ascent-stairs' && !c.ramp))
      ctx.addIssue({ code: 'custom', message: '楼梯模型必须使用坡面碰撞体' });
    for (const p of [map.spawn, ...map.checkpoints]) {
      if (p.x >= map.size || p.z >= map.size)
        ctx.addIssue({ code: 'custom', message: '出生点和检查点必须在地图内' });
      if (
        !map.ground &&
        !map.colliders.some(
          (c) =>
            !c.ramp &&
            c.shape !== 'sphere' &&
            Math.abs(p.x - c.x) < c.width / 2 - 0.2 &&
            Math.abs(p.z - c.z) < c.depth / 2 - 0.2 &&
            Math.abs(p.y - (c.y + c.height / 2)) < 0.08,
        )
      )
        ctx.addIssue({ code: 'custom', message: '出生点和检查点必须位于可站立的平台上' });
      if (
        map.colliders.some(
          (c) =>
            Math.abs(p.x - c.x) < c.width / 2 + 0.22 &&
            Math.abs(p.z - c.z) < c.depth / 2 + 0.22 &&
            c.y + c.height / 2 > p.y + 0.1 &&
            c.y - c.height / 2 < p.y + 1.75,
        )
      )
        ctx.addIssue({ code: 'custom', message: '出生点或检查点没有足够站立空间' });
    }
  });
export type MapDocument = z.infer<typeof mapDocumentSchema>;
export function mapFromDocument(value: unknown): MapDefinition {
  const map = mapDocumentSchema.parse(value);
  const definition: MapDefinition = {
    ...map,
    grid: Array.from({ length: map.size }, () => '.'.repeat(map.size)),
    climbable: false,
    killY: map.ground ? (map.groundY ?? 0) - 5 : -1,
  };
  definition.colliders.push(...forestLayout(definition).flatMap((p) => (p.solid ? [p.solid] : [])));
  return definition;
}
export { parkourMaps } from './parkour-maps.ts';
