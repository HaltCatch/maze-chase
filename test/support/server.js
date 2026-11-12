import { spawn } from 'node:child_process';
import { once } from 'node:events';
/** Real native Colyseus server on an isolated ephemeral loopback port. */
export async function startTestServer(t) {
  const server = spawn(process.execPath, ['src/server/main.ts'], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', PUBLIC_ORIGIN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  server.stderr.on('data', (chunk) => (stderr += chunk));
  t.after(async () => {
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await once(server, 'exit');
    }
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    server.once('exit', (code) => reject(new Error('server exited ' + code + stderr)));
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const line = output.split('\n').find((l) => l.includes('"event":"listening"'));
      if (line) resolve(JSON.parse(line).port);
    });
  });
  return { server, root: 'http://127.0.0.1:' + port, logs: () => stderr };
}
