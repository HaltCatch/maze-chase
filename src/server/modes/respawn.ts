import { cell, sight } from '../../shared/world.js';
import { docksSpawn } from '../../shared/docks.js';

type Actor = { x: number; z: number; y?: number; side: number; alive: boolean };
/** Quake III SelectRandomFurthestSpawnPoint rule reference, adapted to our grid.
 * Prefer covered, unoccupied candidates; choose among the safest few to avoid a fixed camp.
 * Runs only on a knockout, not per frame. No upstream C source is copied.
 */
export function combatRespawn(
  room: { map: string[]; round: number; mode: string; players: Actor[] },
  player: Actor,
  random = Math.random,
) {
  const enemies = room.players.filter((p) => p !== player && p.alive && p.side !== player.side);
  const base = docksSpawn[(player.side + room.round) % 2];
  const spots: { x: number; z: number; score: number }[] = [];
  for (let z = 2; z < room.map.length - 2; z += 2)
    for (let x = 2; x < room.map[0].length - 2; x += 2) {
      const p = { x: x + 0.5, z: z + 0.5, y: 0 };
      if (room.mode === 'duel' && Math.abs(p.z - base.z) > 5) continue;
      if (cell(room.map, p.x, p.z) !== '.') continue;
      if (room.players.some((q) => q !== player && q.alive && Math.hypot(q.x - p.x, q.z - p.z) < 2))
        continue;
      const distance = Math.min(30, ...enemies.map((q) => Math.hypot(q.x - p.x, q.z - p.z)));
      const covered = !enemies.some((q) => sight(room.map, p, q));
      spots.push({ ...p, score: distance + (covered ? 20 : 0) });
    }
  spots.sort((a, b) => b.score - a.score);
  const safe = spots.filter((p) => p.score >= (spots[0]?.score ?? 0) - 3).slice(0, 4);
  const chosen = safe[Math.floor(random() * safe.length)] ?? base;
  return { x: chosen.x, z: chosen.z, yaw: Math.atan2(chosen.x - 12.5, chosen.z - 12.5) };
}
