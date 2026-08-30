import {Compass, LoaderCircle, RefreshCw, SearchX} from 'lucide-react';
import {useEffect, useState} from 'react';

import {fetchPublicGuilds} from '../api/publicServers';
import PublicServerCard from '../components/PublicServerCard';
import type {PublicGuild} from '../types';

export default function PublicServers() {
  const [guilds, setGuilds] = useState<PublicGuild[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    fetchPublicGuilds(controller.signal)
      .then(setGuilds)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [requestKey]);

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-12 md:px-8 md:py-16">
      <header className="max-w-3xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-indigo-200">
          <Compass className="h-4 w-4" aria-hidden="true" /> Community discovery
        </div>
        <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Explore Study Servers</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">
          Find a Discord community that matches how you study. Every server here is active and intentionally shared by its admins.
        </p>
      </header>

      {failed ? (
        <section className="mt-12 rounded-[28px] border border-red-400/20 bg-red-500/[0.06] p-8 text-center" role="alert">
          <RefreshCw className="mx-auto h-8 w-8 text-red-300" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-bold">Servers could not be loaded</h2>
          <p className="mt-2 text-sm text-slate-400">Check your connection and try again.</p>
          <button type="button" onClick={() => setRequestKey((value) => value + 1)} className="mt-5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950 hover:bg-slate-200">
            Try again
          </button>
        </section>
      ) : guilds === null ? (
        <div className="mt-16 flex min-h-56 items-center justify-center text-slate-400" aria-live="polite">
          <LoaderCircle className="mr-3 h-5 w-5 animate-spin" aria-hidden="true" /> Loading study servers…
        </div>
      ) : guilds.length === 0 ? (
        <section className="mt-12 rounded-[28px] border border-white/10 bg-white/[0.035] p-10 text-center">
          <SearchX className="mx-auto h-9 w-9 text-slate-600" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-bold">No public servers yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">Server admins are still preparing their public listings. Check back soon.</p>
        </section>
      ) : (
        <section className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-3" aria-label="Public study servers">
          {guilds.map((guild) => (
            <div key={guild.slug} className="min-w-0">
              <PublicServerCard guild={guild} />
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
