const TITLES = ['Rookie', 'Jogger', 'Sprinter', 'Tracker', 'Pathfinder', 'Ranger', 'Ghost', 'Legend'];

export function rankTitle(level: number): string {
  return TITLES[Math.min(TITLES.length - 1, Math.floor((level - 1) / 2))];
}

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
