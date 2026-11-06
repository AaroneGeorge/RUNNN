import type { ClientMsg, RoomView, ServerMsg } from '@runnn/shared';
import { getLastName, getProfileToken, getSession, setSession } from './storage.ts';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ConnHandlers {
  onView(v: RoomView): void;
  onToast(m: Extract<ServerMsg, { t: 'toast' }>): void;
  onError(msg: string, fatal: boolean): void;
  onStatus(s: ConnStatus): void;
  onJoined?(m: Extract<ServerMsg, { t: 'joined' }>): void;
}

/** One socket per game, automatic reconnect with capped backoff, smoothed clock offset. */
export class GameConnection {
  /** serverNow − Date.now(), smoothed. */
  offset = 0;
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private timer: number | null = null;
  private pinger: number | null = null;

  constructor(
    private code: string,
    private h: ConnHandlers,
    private extra: { spectate?: boolean } = {},
  ) {
    this.open();
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  private open() {
    this.h.onStatus(this.retry ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.h.onStatus('open');
      const s = getSession(this.code);
      const join: ClientMsg = {
        t: 'join',
        code: this.code,
        name: s.name ?? getLastName(),
        bib: s.bib,
        playerId: s.playerId,
        secret: s.secret,
        organiserKey: s.organiserKey,
        profileToken: getProfileToken() ?? undefined,
        spectate: this.extra.spectate,
      };
      ws.send(JSON.stringify(join));
      this.pinger = window.setInterval(() => this.send({ t: 'ping' }), 25_000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.t) {
        case 'joined':
          setSession(msg.code, { playerId: msg.playerId, secret: msg.secret });
          this.h.onJoined?.(msg);
          break;
        case 'view': {
          // Never take the offset from a paused view: its serverNow is frozen.
          if (msg.view.phase !== 'paused') {
            const off = msg.view.serverNow - Date.now();
            this.offset = this.offset === 0 ? off : this.offset * 0.8 + off * 0.2;
          }
          this.h.onView(msg.view);
          break;
        }
        case 'toast':
          this.h.onToast(msg);
          break;
        case 'error':
          this.h.onError(msg.msg, !!msg.fatal);
          if (msg.fatal) this.stop();
          break;
        case 'pong':
          break;
      }
    };
    ws.onclose = () => {
      if (this.pinger) clearInterval(this.pinger);
      this.pinger = null;
      if (this.stopped) return this.h.onStatus('closed');
      this.h.onStatus('reconnecting');
      this.timer = window.setTimeout(() => this.open(), Math.min(8000, 500 * 2 ** this.retry++));
    };
  }

  send(msg: ClientMsg): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  /** Reconnect right away, e.g. when the tab becomes visible again. */
  kick() {
    if (this.stopped) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.timer) clearTimeout(this.timer);
    this.retry = 0;
    this.open();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.pinger) clearInterval(this.pinger);
    this.ws?.close();
  }
}
