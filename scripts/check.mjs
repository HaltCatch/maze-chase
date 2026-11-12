import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// TS is checked by tsc. Keep all remaining ESM, including browser modules, in
// the syntax gate while modules are migrated incrementally.
let checked = 0;
for (const folder of ['src', 'scripts']) {
  for (const file of await readdir(folder, { recursive: true })) {
    if (!/\.(m?js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', folder + '/' + file], {
      stdio: 'inherit',
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
    checked++;
  }
}
console.log('ESM syntax:', checked, 'modules');
