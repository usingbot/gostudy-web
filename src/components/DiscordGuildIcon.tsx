interface DiscordGuildIconSource {
  name: string;
  iconUrl: string | null;
}

const SIZE_CLASSES = {
  compact: 'h-14 w-14 text-base',
  card: 'h-16 w-16 text-lg',
  hero: 'h-24 w-24 text-2xl',
} as const;

const RADIUS_CLASSES = {
  compact: 'rounded-2xl',
  card: 'rounded-2xl',
  hero: 'rounded-[28px]',
} as const;

export default function DiscordGuildIcon({
  guild,
  size = 'card',
}: {
  guild: DiscordGuildIconSource;
  size?: keyof typeof SIZE_CLASSES;
}) {
  const dimensions = SIZE_CLASSES[size];

  if (guild.iconUrl) {
    return (
      <div className={`relative flex shrink-0 items-center justify-center bg-transparent ${dimensions}`}>
        <img
          src={guild.iconUrl}
          alt={`${guild.name} server icon`}
          className="block h-full w-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.45)]"
        />
      </div>
    );
  }

  const fallback = guild.name.trim().slice(0, 2).toUpperCase() || 'GS';
  return (
    <div
      role="img"
      aria-label={`${guild.name} server icon`}
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-500 to-violet-700 font-black text-white shadow-lg shadow-indigo-950/30 ${dimensions} ${RADIUS_CLASSES[size]}`}
    >
      <span aria-hidden="true">{fallback}</span>
    </div>
  );
}
