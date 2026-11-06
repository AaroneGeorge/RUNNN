import type { GameId } from '@runnn/shared';
import { chase } from './chase.ts';
import type { GameModule } from './types.ts';

export const MODULES: Record<GameId, GameModule> = { chase };

export type { GameModule } from './types.ts';
