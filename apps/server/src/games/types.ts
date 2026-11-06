import type { ActionDef, EndReason, GameResult, Hud, MapMarker, Stage } from '@runnn/shared';
import type { Player, Room } from '../room.ts';

/**
 * One module per game. The engine (room.ts) owns rooms, clocks and sockets;
 * a module owns the rules.
 *
 * Clock discipline: everything a module stores uses the game clock `room.now()`;
 * everything it sends to a client goes through `room.wall(t)`.
 */
export interface GameModule {
  /** Assign sides when the countdown starts. */
  deal?(room: Room): void;
  /** Fresh per-round state, stored on room.state. Called when the round goes live. */
  init(room: Room): unknown;
  lateJoin(room: Room, p: Player): void;
  roleIntro(room: Room, p: Player): string;
  /** ~4 Hz. */
  tick(room: Room): void;
  /** What buttons this player has, right now. `act()` re-validates against this list. */
  actions(room: Room, p: Player): ActionDef[];
  action(room: Room, p: Player, action: string, code?: string): void;
  /** A camera frame saw this QR. */
  scan?(room: Room, p: Player, qr: string): void;
  checkEnd(room: Room): EndReason | null;
  finish(room: Room, reason: EndReason): GameResult;
  hud(room: Room, p: Player): Hud;
  markers(room: Room, p: Player): MapMarker[];
  stage(room: Room, p: Player): Stage | null;
  hint(room: Room, p: Player): string;
  colorFor(room: Room, p: Player): string;
  emojiFor(room: Room, p: Player): string;
  points(room: Room, p: Player): { runner: number | null; hunter: number | null };
  botThink?(room: Room, bot: Player): void;
  playerLeft?(room: Room, p: Player): void;
  playerOut?(room: Room, p: Player): void;
}
