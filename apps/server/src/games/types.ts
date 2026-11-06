import type { ActionDef, GameResult, Hud, MapMarker, Stage } from '@kalikkam/shared';
import type { Player, Room } from '../room.ts';

/**
 * A game is a set of pure-ish hooks over a Room. All timestamps a module
 * stores use the room's game clock (room.now()); anything sent to clients
 * (stage.endsAt, hud times) must go through room.wall().
 * Action cooldownUntil values stay on the game clock — the room converts them.
 */
export interface GameModule {
  /** Assign teams when the countdown starts, so every phone can show its team before the game. */
  deal?(room: Room): void;
  init(room: Room): any;
  lateJoin(room: Room, p: Player): void;
  roleIntro(room: Room, p: Player): string;
  tick(room: Room): void;
  actions(room: Room, p: Player): ActionDef[];
  /** `code`: extra input for the action, e.g. the catch code typed for 'gotTagged'. */
  action(room: Room, p: Player, action: string, code?: string): void;
  /** A camera on `p`'s phone sees `qr` right now (sent repeatedly while it stays in view). */
  scan?(room: Room, p: Player, qr: string): void;
  checkEnd(room: Room): string | null;
  finish(room: Room, reason: string): GameResult;
  hud(room: Room, p: Player): Hud;
  markers(room: Room, p: Player): MapMarker[];
  stage(room: Room, p: Player): Stage | null;
  hint(room: Room, p: Player): string;
  colorFor(room: Room, p: Player): string;
  emojiFor(room: Room, p: Player): string;
  botThink?(room: Room, bot: Player): void;
  playerLeft?(room: Room, p: Player): void;
  /** `p` was eliminated (stayed outside the play area): drop them from anything in progress. */
  playerOut?(room: Room, p: Player): void;
}
