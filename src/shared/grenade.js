// Adapted from SANDLINE src/game/grenades.ts at cab1248956b0b8557f62b1f770ffffa7b0098e01 (MIT).
// Collision callback replaces SANDLINE's map boxes. See LICENSES/sandline.txt.
const radius = 0.08;

export function advanceGrenade(g, dt, gravity, solid) {
  const steps = Math.max(1, Math.ceil((Math.hypot(g.vx, g.vy, g.vz) * dt) / 0.04));
  const h = dt / steps;
  let impact = 0;
  for (let i = 0; i < steps; i++) {
    g.vy -= gravity * h;
    const nx = g.x + g.vx * h;
    if (solid(nx + Math.sign(g.vx) * radius, g.y, g.z)) {
      impact = Math.max(impact, Math.abs(g.vx));
      g.vx *= -0.48;
    } else g.x = nx;
    const nz = g.z + g.vz * h;
    if (solid(g.x, g.y, nz + Math.sign(g.vz) * radius)) {
      impact = Math.max(impact, Math.abs(g.vz));
      g.vz *= -0.48;
    } else g.z = nz;
    const ny = g.y + g.vy * h;
    if (ny < radius || solid(g.x, ny + Math.sign(g.vy) * radius, g.z)) {
      impact = Math.max(impact, Math.abs(g.vy));
      g.vy = Math.abs(g.vy) < 0.5 ? 0 : -g.vy * 0.36;
      g.vx *= 0.91;
      g.vz *= 0.91;
    } else g.y = ny;
  }
  return impact;
}
