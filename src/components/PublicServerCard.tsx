import {ArrowUpRight, Users} from 'lucide-react';
import {Link} from 'react-router-dom';

import type {PublicGuild} from '../types';
import DiscordGuildIcon from './DiscordGuildIcon';

export function MemberCount({count}: {count: number | null}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-400">
      <Users className="h-4 w-4" aria-hidden="true" />
      {count === null ? 'Member count unavailable' : `${count.toLocaleString()} members`}
    </span>
  );
}

export function GuildTags({tags}: {tags: string[]}) {
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Server tags">
      {tags.slice(0, 5).map((tag) => (
        <li key={tag} className="rounded-full border border-indigo-400/20 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-200">
          {tag}
        </li>
      ))}
    </ul>
  );
}

export default function PublicServerCard({guild}: {guild: PublicGuild}) {
  return (
    <article className="group flex min-h-[420px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/20 transition-[border-color,background-color,box-shadow] duration-300 hover:border-indigo-400/30 hover:bg-white/[0.065] hover:shadow-indigo-950/25 focus-within:border-indigo-300/50 focus-within:ring-2 focus-within:ring-indigo-400/30 motion-reduce:transition-none">
      <div className="relative h-36 overflow-hidden bg-gradient-to-br from-indigo-950 via-slate-900 to-violet-950">
        {guild.bannerUrl ? (
          <img src={guild.bannerUrl} alt="" className="block h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.35),transparent_45%),radial-gradient(circle_at_bottom_left,rgba(99,102,241,0.28),transparent_42%)]" aria-hidden="true" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#121217]/75 to-transparent" aria-hidden="true" />
      </div>

      <div className="-mt-9 flex flex-1 flex-col px-6 pb-6">
        <DiscordGuildIcon guild={guild} />
        <div className="mt-4 flex-1">
          <h2 className="text-xl font-bold tracking-tight text-white">{guild.name}</h2>
          <div className="mt-2"><MemberCount count={guild.memberCount} /></div>
          <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-400">
            {guild.description || 'This community has not added a Discord description yet.'}
          </p>
          <div className="mt-4"><GuildTags tags={guild.tags} /></div>
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Link
            to={`/servers/${guild.slug}`}
            className="inline-flex items-center justify-center rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-400"
          >
            View Server
          </Link>
          {guild.inviteUrl && (
            <a
              href={guild.inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-bold text-slate-200 transition hover:border-indigo-400/40 hover:text-white"
            >
              Join Server <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
