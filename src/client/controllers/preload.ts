import { characterDefinitions } from '../../content/characters.ts';
import { harborMode, weapons } from '../../shared/arsenal.ts';
import { initPhysics } from '../../engine/physics.ts';
import { fetchModel } from '../render/assets.ts';
interface RoomAssets {
  mode: string;
  aiCount: number;
  members: { character: string }[];
}
export async function prepareMatchAssets(room: RoomAssets) {
  const port = harborMode(room.mode),
    parkour = room.mode === 'parkour';
  const characters = [...room.members];
  if ((!port && !parkour) || room.mode === 'survival') characters.push({ character: 'operator' });
  if (room.aiCount) characters.push({ character: 'rogue' });
  const names = new Set<string>(
    characters.flatMap((member) => {
      const c =
        characterDefinitions[member.character as keyof typeof characterDefinitions] ??
        characterDefinitions.operator;
      return [c.model, ...c.animations];
    }),
  );
  if (!parkour) {
    for (const [name, spec] of Object.entries(weapons)) {
      if (name === 'flash' || ('port' in spec && spec.port) === port) names.add(name);
    }
    names.add('arms');
    names.add(port ? 'ammo-box' : 'arrow');
    if (!port) {
      names.add('maze-lever');
      names.add('maze-exit');
    }
  }
  await Promise.all([initPhysics(), ...[...names].map(fetchModel)]);
}
