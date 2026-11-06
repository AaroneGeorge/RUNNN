/** Competition ranking: equal scores share a place, and the next place skips (200, 200, 120 → 1, 1, 3). */
export const rankIn = (scores: number[], score: number) => 1 + scores.filter((s) => s > score).length;
