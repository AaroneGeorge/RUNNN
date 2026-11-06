import type { ClientMsg, RoomView, ServerMsg } from '@kalikkam/shared';
import { getSession, setSession, type Session } from './storage.ts';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ConnHandlers {
  onView(v: RoomView): void;
  onToast(text: string, kind: 'info' | 'good' | 'bad' | 'alert', vibrate?: number[]): void;
  onError(msg: string, fatal: boolean, beforeJoin: boolean): void;
  onStatus(s: ConnStatus): void;
  onJoined(isHost: boolean): void;
}

/**
 * One WebSocket to the game server with automatic reconnect. The session
 * (playerId + secret) is saved per room, so a dropped signal or a reload
 * puts you straight back into the same role.
 */
export class GameConnection {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private joined = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** serverNow - Date.now(), smoothed. */
  offset = 0;

  constructor(
    readonly code: string,
    private join: { name: string; vest?: string; profileToken?: string },
    private h: ConnHandlers,
  ) {}

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.h.onStatus(this.retry ? 'reconnecting' : 'connecting');
    ws.onopen = () => {
      const s: Session = getSession(this.code) ?? {};
      ws.send(
        JSON.stringify({
          t: 'join',
          code: this.code,
          name: s.name ?? this.join.name,
          vest: s.vest ?? this.join.vest,
          playerId: s.playerId,
          secret: s.secret,
          hostKey: s.hostKey,
          profileToken: this.join.profileToken,
        } satisfies ClientMsg),
      );
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.t) {
        case 'joined': {
          this.retry = 0;
          this.joined = true;
          const s = getSession(this.code) ?? {};
          setSession(this.code, { ...s, playerId: msg.playerId, secret: msg.secret, name: s.name ?? this.join.name, vest: s.vest ?? this.join.vest });
          this.h.onStatus('open');
          this.h.onJoined(msg.isHost);
          break;
        }
        case 'view': {
          const off = msg.view.serverNow - Date.now();
          // Paused views freeze serverNow; don't let that drag the offset.
          if (msg.view.phase !== 'paused') this.offset = this.offset === 0 ? off : this.offset * 0.8 + off * 0.2;
          this.h.onView(msg.view);
          break;
        }
        case 'toast':
          this.h.onToast(msg.text, msg.kind, msg.vibrate);
          break;
        case 'error':
          if (msg.fatal) {
            this.stopped = true;
            setSession(this.code, null);
          }
          if (!this.joined && !msg.fatal) {
            // Join rejected (e.g. vest taken): stop and let the user fix it.
            this.stopped = true;
            ws.close();
          }
          this.h.onError(msg.msg, !!msg.fatal, !this.joined);
          break;
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.joined = false;
      if (this.stopped) return this.h.onStatus('closed');
      this.h.onStatus('reconnecting');
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.open(), delay);
    };
  }
}
