import { Room, type Client, type AuthContext } from '@colyseus/core';
import { log } from '../log.js';
import { StateView } from '@colyseus/schema';
import { MoveInput, Pose, writePose } from '../../network/movement.ts';
import { RoomState, type RoomOptions } from '../../network/state.ts';
import { initPhysics } from '../../engine/physics.ts';
import { readFile } from 'node:fs/promises';
import { MatchSession } from './session.js';
import { isGameMode, decodeClientPacket } from '../../shared/protocol.ts';
import { arenas } from '../../shared/docks.js';
import { mapDocumentSchema, parkourMaps } from '../../content/map-document.ts';

const integer = (n: unknown, fallback: number, min: number, max: number) =>
  typeof n === 'number' && Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback;
export class GameRoom extends Room<{
  state: InstanceType<typeof RoomState>;
  input: InstanceType<typeof MoveInput>;
}> {
  private static active = new Set<string>();
  session!: MatchSession;
  inputs = this.defineInput(MoveInput, { bufferMaxSize: 8 });
  private clientErrors = new Map<string, number>();
  private rates = new Map<string, { at: number; count: number }>();
  async onCreate(options: RoomOptions) {
    if (!isGameMode(options.mode)) throw new Error('不支持的玩法');
    if (GameRoom.active.size >= 8) throw new Error('房间已满，请先加入已有房间');
    GameRoom.active.add(this.roomId);
    try {
      this.maxClients = integer(options.maxPlayers, 2, 1, 8);
      const parkour = options.mode === 'parkour';
      const catalog = parkour ? parkourMaps : arenas;
      const arena =
        options.arena && Object.hasOwn(catalog, options.arena)
          ? options.arena
          : parkour
            ? 'ascent'
            : 'docks';
      const customMap =
        parkour && options.customMap ? mapDocumentSchema.parse(options.customMap) : undefined;
      const maze = ['escape', 'practice'].includes(options.mode);
      const jumpPickup =
        parkour && (customMap ?? parkourMaps[arena]).pickups?.some((p) => p.kind === 'double-jump');
      this.state = new RoomState({
        mode: options.mode,
        arena: maze ? '' : arena,
        capacity: this.maxClients,
      });
      const havok = await initPhysics(
        await readFile(new URL(import.meta.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'))),
      );
      this.session = new MatchSession(
        this.roomId,
        {
          ...options,
          customMap,
          arena: maze ? undefined : arena,
          maxPlayers: this.maxClients,
          aiCount: parkour ? 0 : integer(options.aiCount, -1, -1, 8),
          allowClimb: maze && options.allowClimb === true,
          doubleJump:
            !jumpPickup && options.doubleJump === true && (!maze || options.allowClimb === true),
          airJumpHeight: [0.7, 1, 1.3].includes(options.airJumpHeight ?? 0)
            ? options.airJumpHeight
            : 1,
        },
        havok,
        (p: { connection: Client }, packet: unknown) => p.connection.send('game', packet),
        () => this.publish(),
      );
      this.onMessage('command', (client, raw) => {
        const now = Date.now(),
          rate = this.rates.get(client.sessionId) ?? { at: now, count: 0 };
        if (now - rate.at >= 1000) {
          rate.at = now;
          rate.count = 0;
        }
        this.rates.set(client.sessionId, rate);
        if (++rate.count > 100) {
          client.leave(4008, '操作过于频繁');
          return;
        }
        const packet = decodeClientPacket(JSON.stringify(raw));
        if (!packet) return;
        if (packet.type === 'client-error') {
          if (now - (this.clientErrors.get(client.sessionId) ?? 0) > 5000) {
            this.clientErrors.set(client.sessionId, now);
            log('warn', 'client-error', {
              room: this.roomId,
              session: client.sessionId,
              message: String(packet.message ?? '').slice(0, 240),
            });
          }
          return;
        }
        const player = this.session.room.players.find((p) => p.id === client.sessionId);
        if (player) this.session.handle(player, packet);
      });
      this.setFixedTimestep(() => {
        const commands = new Map();
        for (const p of this.session.room.players) {
          if (p.bot) continue;
          const cmd = this.inputs.get(p.id).next();
          if (cmd) commands.set(p.id, cmd);
        }
        this.session.tick(commands);
        for (const p of this.session.room.players) {
          const pose = this.state.poses.get(p.id);
          if (pose) writePose(pose, p);
        }
      }, 20);
      await this.setMetadata({
        host: options.name || '玩家',
        mode: options.mode,
        arena: maze ? '' : arena,
        playing: false,
        maxPlayers: this.maxClients,
      });
    } catch (error) {
      GameRoom.active.delete(this.roomId);
      throw error;
    }
  }
  onAuth(_client: Client, _options: unknown, context: AuthContext) {
    const origin = context.headers.get('origin'),
      host = context.headers.get('host');
    if (origin !== (process.env.PUBLIC_ORIGIN || 'http://' + host))
      throw new Error('Origin rejected');
    return true;
  }
  onJoin(client: Client, options: RoomOptions) {
    const name =
      String(options.name || '玩家')
        .normalize('NFKC')
        .replace(/[\p{C}]/gu, '')
        .trim()
        .slice(0, 18) || '玩家';
    const pose = new Pose();
    this.state.poses.set(client.sessionId, pose);
    client.view = new StateView();
    client.view.add(pose);
    this.session.add(client.sessionId, name, client);
    log('info', 'player-joined', { room: this.roomId, session: client.sessionId });
    client.send('game', { type: 'welcome', name });
  }
  async onDrop(client: Client, code?: number) {
    const p = this.session.room.players.find((p) => p.id === client.sessionId);
    log(code === 1000 || code === 1001 ? 'info' : 'warn', 'player-disconnected', {
      room: this.roomId,
      session: client.sessionId,
      code,
    });
    if (p) {
      p.connection = null;
      p.input = { f: false, b: false, l: false, r: false, run: false, quiet: false };
    }
    try {
      await this.allowReconnection(client, 20);
    } catch {
      /* onLeave owns cleanup */
    }
  }
  onReconnect(client: Client) {
    const p = this.session.room.players.find((p) => p.id === client.sessionId);
    if (!p) return;
    p.connection = client;
    p.spawnSafeUntil = Date.now() + 15000;
    client.view = new StateView();
    const pose = this.state.poses.get(client.sessionId);
    if (pose) client.view.add(pose);
    this.session.lobby();
    if (this.session.room.phase !== 'lobby') this.session.resume(p);
  }
  onLeave(client: Client, code?: number) {
    const p = this.session.room.players.find((p) => p.id === client.sessionId);
    if (p) this.session.remove(p);
    this.rates.delete(client.sessionId);
    this.clientErrors.delete(client.sessionId);
    log('info', 'player-left', { room: this.roomId, session: client.sessionId, code });
    this.state.poses.delete(client.sessionId);
  }
  onDispose() {
    GameRoom.active.delete(this.roomId);
    this.session?.dispose();
  }
  private publish() {
    const r = this.session.room;
    this.state.phase = r.phase;
    this.state.revision = r.revision;
    this.state.humans = r.players.filter((p) => !p.bot).length;
    void (r.phase === 'lobby' ? this.unlock() : this.lock()).catch((error) =>
      log('error', 'room-listing', { room: this.roomId, message: String(error) }),
    );
    void this.setMetadata({
      host: r.players.find((p) => !p.bot)?.name || '玩家',
      mode: r.mode,
      arena: r.arena,
      playing: r.phase !== 'lobby',
      maxPlayers: this.maxClients,
      blackout: r.blackout,
    }).catch((error) =>
      log('error', 'room-metadata', { room: this.roomId, message: String(error) }),
    );
  }
}
