import { Client, type Room } from '@colyseus/sdk';
import type { RoomState } from './state.ts';
export type Packet = { type: string; [key: string]: unknown };
export class GameConnection {
  private sdk: Client;
  private matchEpoch = 0;
  private lobby?: Room;
  private match?: Room<unknown, InstanceType<typeof RoomState>>;
  get activeRoom() {
    return this.match;
  }
  private rooms = new Map<string, Record<string, unknown>>();
  private online = 0;
  private name = '';
  private joining = false;
  connected = false;
  private closed = false;
  constructor(
    privateReceive: (packet: Packet) => void,
    privateStatus: (connected: boolean, message?: string) => void,
    sdk?: Client,
  ) {
    this.sdk = sdk ?? new Client(location.origin);
    this.receive = (packet) => {
      if (!this.closed) privateReceive(packet);
    };
    this.status = (connected, message) => {
      if (!this.closed) privateStatus(connected, message);
    };
  }
  private receive: (packet: Packet) => void;
  private status: (connected: boolean, message?: string) => void;
  async connect(name: string) {
    this.name = name;
    try {
      this.lobby = await this.sdk.joinOrCreate('lobby', { filter: { name: 'match' } });
      if (this.closed) {
        await this.lobby.leave();
        return;
      }
      this.lobby.onMessage('rooms', (rows: Record<string, unknown>[]) => {
        this.rooms.clear();
        for (const row of rows) this.rooms.set(String(row.roomId), row);
        this.directory();
      });
      this.lobby.onMessage('+', ([id, row]: [string, Record<string, unknown>]) => {
        this.rooms.set(id, row);
        this.directory();
      });
      this.lobby.onMessage('-', (id: string) => {
        this.rooms.delete(id);
        this.directory();
      });
      this.lobby.onMessage('online', (count: number) => {
        this.online = count;
        this.directory();
      });
      this.lobby.onLeave(() => {
        this.connected = false;
        this.status(false, '大厅连接已断开，可重新连接');
      });
      this.connected = true;
      this.status(true);
    } catch (error) {
      this.status(false, String(error));
    }
  }
  private directory() {
    this.receive({
      type: 'directory',
      online: this.online,
      rooms: [...this.rooms].map(([id, r]) => {
        const m = (r.metadata ?? {}) as Record<string, unknown>;
        return { ...m, id, count: r.clients, joinable: !r.locked && !m.playing };
      }),
    });
  }
  async send(packet: Packet) {
    if (packet.type === 'create' || packet.type === 'join') {
      if (this.joining || this.match) return;
      this.joining = true;
      const epoch = ++this.matchEpoch;
      try {
        const room =
          packet.type === 'create'
            ? await this.sdk.create('match', { ...packet, name: this.name })
            : await this.sdk.joinById(String(packet.room), { name: this.name });
        if (this.closed || epoch !== this.matchEpoch) {
          await room.leave();
          return;
        }
        this.match = room;
        const current = () => !this.closed && epoch === this.matchEpoch && this.match === room;
        room.reconnection.minUptime = 0;
        room.onDrop(() => {
          if (current()) this.receive({ type: 'connection-lost' });
        });
        room.onReconnect(() => {
          if (current()) this.receive({ type: 'connection-restored' });
        });
        room.onMessage('game', (m: Packet) => {
          if (current()) this.receive(m);
        });
        room.onLeave((code) => {
          if (!current()) return;
          this.match = undefined;
          this.receive({ type: 'left' });
          this.receive({ type: 'error', message: '已离开对局（' + code + '）' });
        });
        room.onError((_code, message) => {
          if (current()) this.receive({ type: 'error', message });
        });
        room.send('command', { type: 'hello', name: this.name });
      } catch (error) {
        if (epoch !== this.matchEpoch || this.closed) return;
        this.receive({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (epoch === this.matchEpoch) this.joining = false;
      }
      return;
    }
    if (packet.type === 'leave') {
      ++this.matchEpoch;
      this.joining = false;
      const previous = this.match;
      this.match = undefined;
      this.receive({ type: 'left' });
      if (previous) {
        previous.reconnection.enabled = false;
        await previous.leave().catch(() => {});
      }
      return;
    }
    if (packet.type === 'hello' && typeof packet.name === 'string') this.name = packet.name;
    this.match?.send('command', packet);
  }
  async close() {
    ++this.matchEpoch;
    this.joining = false;
    this.closed = true;
    this.connected = false;
    const lobby = this.lobby,
      match = this.match;
    this.lobby = this.match = undefined;
    await Promise.allSettled([match?.leave(), lobby?.leave()]);
  }
}
