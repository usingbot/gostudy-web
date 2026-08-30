import type {GuildBoardTheme} from './types';

export interface GuildBoardThemeDefinition {
  key: GuildBoardTheme;
  label: string;
  description: string;
  className: string;
}

export const GUILD_BOARD_THEMES: readonly GuildBoardThemeDefinition[] = [
  {
    key: 'midnight',
    label: 'Midnight',
    description: 'Deep navy with a quiet study-grid texture.',
    className: 'guild-board-theme-midnight',
  },
  {
    key: 'mint',
    label: 'Mint',
    description: 'Cool green with a clean, softly ruled surface.',
    className: 'guild-board-theme-mint',
  },
  {
    key: 'cork',
    label: 'Cork',
    description: 'Warm, tactile color inspired by a classic pinboard.',
    className: 'guild-board-theme-cork',
  },
  {
    key: 'paper',
    label: 'Paper',
    description: 'Bright neutral paper with subtle notebook lines.',
    className: 'guild-board-theme-paper',
  },
] as const;

const THEME_BY_KEY = new Map(
  GUILD_BOARD_THEMES.map((theme) => [theme.key, theme] as const),
);

export function getGuildBoardTheme(theme: GuildBoardTheme): GuildBoardThemeDefinition {
  return THEME_BY_KEY.get(theme) ?? GUILD_BOARD_THEMES[0];
}
