import { Server, LobbyRoom, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/game-room.ts';
import { staticHandler } from './static.js';
import { log } from './log.js';
const transport = new WebSocketTransport({
  maxPayload: 32768,
  perMessageDeflate: false,
  pingInterval: 10000,
  pingMaxRetries: 2,
  verifyClient: (info: { origin: string; req: import('node:http').IncomingMessage }) =>
    info.origin === (process.env.PUBLIC_ORIGIN || 'http://' + info.req.headers.host),
});
const game = new Server({
  transport,
  greet: false,
  express: (app) => {
    app.use(staticHandler());
  },
});
class DirectoryRoom extends LobbyRoom {
  onJoin(client: Client, options: { filter?: { name: string; metadata?: unknown } }) {
    super.onJoin(client, options);
    this.broadcast('online', this.clients.length);
  }
  onLeave(client: Client) {
    super.onLeave(client);
    this.broadcast('online', this.clients.length);
  }
}
game.define('lobby', DirectoryRoom);
game.define('match', GameRoom).enableRealtimeListing();
await game.listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0');
const address = transport.server?.address();
log('info', 'listening', {
  port: typeof address === 'object' ? address?.port : Number(process.env.PORT || 8080),
  engine: 'babylon-havok',
  network: 'colyseus',
});
