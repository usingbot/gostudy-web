export const GUILD_BOARD_MIN_ZOOM = 0.3;
export const GUILD_BOARD_MAX_ZOOM = 2;
export const GUILD_BOARD_DESKTOP_FIT_MARGIN = 28;
export const GUILD_BOARD_MOBILE_FIT_MARGIN = 12;

export interface GuildBoardFitGeometry {
  scale: number;
  x: number;
  y: number;
  margin: number;
  renderedWidth: number;
  renderedHeight: number;
}

export function calculateGuildBoardFit({
  viewportWidth,
  viewportHeight,
  boardWidth,
  boardHeight,
}: {
  viewportWidth: number;
  viewportHeight: number;
  boardWidth: number;
  boardHeight: number;
}): GuildBoardFitGeometry {
  const preferredMargin = viewportWidth < 640
    ? GUILD_BOARD_MOBILE_FIT_MARGIN
    : GUILD_BOARD_DESKTOP_FIT_MARGIN;
  const margin = Math.min(
    preferredMargin,
    Math.max(0, (viewportWidth - 1) / 2),
    Math.max(0, (viewportHeight - 1) / 2),
  );
  const scale = Math.max(Number.EPSILON, Math.min(
    (viewportWidth - margin * 2) / boardWidth,
    (viewportHeight - margin * 2) / boardHeight,
  ));
  const renderedWidth = boardWidth * scale;
  const renderedHeight = boardHeight * scale;

  return {
    scale,
    x: (viewportWidth - renderedWidth) / 2,
    y: (viewportHeight - renderedHeight) / 2,
    margin,
    renderedWidth,
    renderedHeight,
  };
}
