import type { GameId } from '@kalikkam/shared';
import type { GameModule } from './types.ts';
import { zombies } from './zombies.ts';

export const MODULES: Record<GameId, GameModule> = { zombies };
