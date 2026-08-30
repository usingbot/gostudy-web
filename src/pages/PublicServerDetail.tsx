import {ArrowLeft, ArrowUpRight, LayoutGrid, LoaderCircle, RefreshCw} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Link, useParams} from 'react-router-dom';

import {fetchPublicGuild, PublicServersApiError} from '../api/publicServers';
import DiscordGuildIcon from '../components/DiscordGuildIcon';
import {GuildTags, MemberCount} from '../components/PublicServerCard';
import type {PublicGuild} from '../types';

type DetailState =
  | {status: 'loading'}
  | {status: 'ready'; guild: PublicGuild}
  | {status: 'not-found'}
  | {status: 'error'};

export default function PublicServerDetail() {
  const {slug = ''} = useParams();
  const [state, setState] = useState<DetailState>({status: 'loading'});
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({status: 'loading'});
    fetchPublicGuild(slug, controller.signal)
      .then((guild) => setState({status: 'ready', guild}))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(error instanceof PublicServersApiError && error.status === 404
          ? {status: 'not-found'}
          : {status: 'error'});
      });
    return () => controller.abort();
  }, [slug, requestKey]);

  useEffect(() => {
    if (state.status === 'ready') {
      document.title = `${state.guild.name} · Go Study`;
      return () => { document.title = 'Go Study'; };
    }
    return undefined;
  }, [state]);

  if (state.status === 'loading') {
    return (
      <main className="flex min-h-[65vh] items-center justify-center text-slate-400" aria-live="polite">
        <LoaderCircle className="mr-3 h-5 w-5 animate-spin" aria-hidden="true" /> Loading server…
      </main>
    );
  }

  if (state.status === 'not-found') {
    return (
      <main className="mx-auto flex min-h-[65vh] max-w-xl flex-col items-center justify-center px-6 text-center">
        <h1 className="text-3xl font-black">Server not found</h1>
        <p className="mt-3 leading-7 text-slate-400">This server is unavailable, inactive, or no longer shared publicly.</p>
        <Link to="/servers" className="mt-6 rounded-xl bg-indigo-500 px-5 py-3 text-sm font-bold hover:bg-indigo-400">Explore public servers</Link>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="mx-auto flex min-h-[65vh] max-w-xl flex-col items-center justify-center px-6 text-center" role="alert">
        <RefreshCw className="h-8 w-8 text-red-300" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-black">This server could not be loaded</h1>
        <p className="mt-3 text-slate-400">Please check your connection and try again.</p>
        <button type="button" onClick={() => setRequestKey((value) => value + 1)} className="mt-6 rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-950 hover:bg-slate-200">Try again</button>
      </main>
    );
  }

  const {guild} = state;
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 md:px-8 md:py-12">
      <Link to="/servers" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition hover:text-white">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All servers
      </Link>

      <article className="mt-6 overflow-hidden rounded-[32px] border border-white/10 bg-[#121217] shadow-2xl shadow-black/30">
        <div className="relative h-52 overflow-hidden bg-gradient-to-br from-indigo-950 via-slate-900 to-violet-950 sm:h-72">
          {guild.bannerUrl ? (
            <img src={guild.bannerUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,rgba(139,92,246,0.4),transparent_38%),radial-gradient(circle_at_15%_80%,rgba(79,70,229,0.3),transparent_42%)]" aria-hidden="true" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#121217] via-transparent to-transparent" aria-hidden="true" />
        </div>

        <div className="relative px-6 pb-8 sm:px-10 sm:pb-10">
          <div className="-mt-12 sm:-mt-14"><DiscordGuildIcon guild={guild} size="hero" /></div>
          <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-3xl">
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{guild.name}</h1>
              <div className="mt-3"><MemberCount count={guild.memberCount} /></div>
              <p className="mt-5 whitespace-pre-wrap text-base leading-7 text-slate-300">
                {guild.description || 'This community has not added a Discord description yet.'}
              </p>
              <div className="mt-5"><GuildTags tags={guild.tags} /></div>
            </div>
            {guild.inviteUrl && (
              <a href={guild.inviteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#6873f5]">
                Join Server <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      </article>

      <section className="mt-8 rounded-[32px] border border-white/10 bg-white/[0.035] p-6 sm:p-10" aria-labelledby="study-board-heading">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300">
            <LayoutGrid className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">Public space</p>
            <h2 id="study-board-heading" className="text-2xl font-black">Study Board</h2>
          </div>
        </div>
        <div className="mt-8 flex min-h-52 items-center justify-center rounded-3xl border border-dashed border-white/15 bg-black/15 px-6 text-center">
          <div className="max-w-md">
            <h3 className="font-bold text-slate-200">The board is ready for its next chapter</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">Public board content is not available yet. This space will become the server’s shared Study Board without inventing posts or activity.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
