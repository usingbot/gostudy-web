export interface GuildBoardCapacity {
  key: 'starter' | 'expanded' | 'large' | 'mega';
  label: string;
  width: number;
  height: number;
}

export const GUILD_BOARD_CAPACITIES: readonly GuildBoardCapacity[] = [
  {key: 'starter', label: 'Starter', width: 3000, height: 1800},
  {key: 'expanded', label: 'Expanded', width: 4500, height: 2700},
  {key: 'large', label: 'Large', width: 6000, height: 3600},
  {key: 'mega', label: 'Mega', width: 9000, height: 5400},
] as const;

export function getGuildBoardCapacity(width: number, height: number): GuildBoardCapacity {
  return GUILD_BOARD_CAPACITIES.find(
    (capacity) => capacity.width === width && capacity.height === height,
  ) ?? GUILD_BOARD_CAPACITIES[0];
}
