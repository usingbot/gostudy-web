import {useEffect, useMemo, useState, type FormEvent} from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Hash,
  LoaderCircle,
  Paintbrush,
  Save,
  ServerCog,
  Users,
  X,
} from 'lucide-react';
import {Link} from 'react-router-dom';

import {
  fetchManageableGuilds,
  GuildPublishingApiError,
  saveGuildPublication,
} from '../api/guildPublishing';
import type {ManageableGuild} from '../types';
import DiscordGuildIcon from '../components/DiscordGuildIcon';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INVITE_PATTERN = /^https:\/\/(?:discord\.gg\/|discord\.com\/invite\/)[A-Za-z0-9-]{2,64}$/;

function formatMembers(count: number | null): string {
  return count === null ? 'Member count unavailable' : `${count.toLocaleString()} members`;
}

function validateForm(slug: string, invite: string, tags: string[]): string | null {
  if (slug.length < 3 || slug.length > 64 || !SLUG_PATTERN.test(slug)) {
    return 'Slug must be 3–64 lowercase letters, numbers, or single hyphens.';
  }
  if (invite !== '' && !INVITE_PATTERN.test(invite)) {
    return 'Use https://discord.gg/code or https://discord.com/invite/code without query text.';
  }
  if (tags.length > 5) return 'A server can have at most five tags.';
  const normalized = tags.map((tag) => tag.trim().normalize('NFC'));
  if (normalized.some((tag) => [...tag].length < 1 || [...tag].length > 24)) {
    return 'Each tag must contain 1–24 visible characters.';
  }
  if (new Set(normalized.map((tag) => tag.toLowerCase())).size !== normalized.length) {
    return 'Tags must be unique, ignoring letter case.';
  }
  return null;
}

function GuildEditor({
  guild,
  onSaved,
}: {
  guild: ManageableGuild;
  onSaved: (guild: ManageableGuild) => void;
}) {
  const [isPublic, setIsPublic] = useState(guild.publication?.isPublic ?? false);
  const [slug, setSlug] = useState(guild.publication?.slug ?? '');
  const [invite, setInvite] = useState(guild.publication?.inviteUrl ?? '');
  const [tags, setTags] = useState<string[]>(guild.publication?.tags ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setIsPublic(guild.publication?.isPublic ?? false);
    setSlug(guild.publication?.slug ?? '');
    setInvite(guild.publication?.inviteUrl ?? '');
    setTags(guild.publication?.tags ?? []);
    setError(null);
    setSaved(false);
  }, [guild]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    const validationError = validateForm(slug, invite, tags);
    if (validationError) {
      setError(validationError);
      setSaved(false);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await saveGuildPublication(guild.guildid, {
        slug,
        isPublic,
        invite: invite || null,
        tags: tags.map((tag) => tag.trim().normalize('NFC')),
      });
      onSaved(updated);
      setSaved(true);
    } catch (requestError) {
      if (requestError instanceof GuildPublishingApiError
        && requestError.code === 'GUILD_SLUG_CONFLICT') {
        setError('That slug is already used by another server.');
      } else if (requestError instanceof GuildPublishingApiError
        && requestError.code === 'GUILD_MANAGEMENT_REQUIRED') {
        setError('Your Discord guild authorization is no longer available. Sign in again.');
      } else {
        setError('The publication settings could not be saved. Please review the fields and retry.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSave(event)} className="overflow-hidden rounded-2xl border border-slate-800 bg-[#18181b]">
      <div className="relative min-h-28 border-b border-slate-800 bg-gradient-to-br from-indigo-950/80 via-slate-900 to-violet-950/70 p-6">
        {guild.bannerUrl && (
          <img src={guild.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
        )}
        <div className="relative flex items-center gap-4">
          <DiscordGuildIcon guild={guild} size="compact" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">Publication settings</p>
            <h2 className="mt-1 text-xl font-bold">{guild.name}</h2>
            <p className="mt-1 font-mono text-xs text-slate-400">{guild.guildid}</p>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-6">
        <label className="flex cursor-pointer items-center justify-between gap-5 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
          <span>
            <span className="block font-semibold">Public server page</span>
            <span className="mt-1 block text-xs text-slate-500">Share this server’s profile and Study Board at its public URL.</span>
          </span>
          <span className="relative inline-flex h-7 w-12 shrink-0 items-center">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(event) => { setIsPublic(event.target.checked); setSaved(false); }}
              className="peer sr-only"
            />
            <span className="absolute inset-0 rounded-full bg-slate-700 transition peer-checked:bg-indigo-500" />
            <span className="relative ml-1 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
          </span>
        </label>

        <div>
          <label htmlFor="guild-slug" className="text-sm font-semibold">Public slug</label>
          <div className="mt-2 flex overflow-hidden rounded-xl border border-slate-700 bg-slate-950 focus-within:border-indigo-500">
            <span className="flex items-center border-r border-slate-800 px-3 text-sm text-slate-500">/servers/</span>
            <input
              id="guild-slug"
              value={slug}
              onChange={(event) => { setSlug(event.target.value); setSaved(false); }}
              placeholder="the-study-forum"
              maxLength={64}
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm outline-none"
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">Lowercase ASCII only; invalid input is never rewritten on save.</p>
        </div>

        <div>
          <label htmlFor="guild-invite" className="text-sm font-semibold">Discord invite</label>
          <input
            id="guild-invite"
            value={invite}
            onChange={(event) => { setInvite(event.target.value); setSaved(false); }}
            placeholder="https://discord.gg/example"
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-indigo-500"
          />
          <p className="mt-2 text-xs text-slate-500">Supply an existing Discord invite. Go Study does not create invites.</p>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold">Tags</label>
            <span className="text-xs text-slate-500">{tags.length}/5</span>
          </div>
          <div className="mt-2 space-y-2">
            {tags.map((tag, index) => (
              <div key={index} className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Hash className="absolute left-3 top-3.5 h-4 w-4 text-slate-600" />
                  <input
                    aria-label={`Tag ${index + 1}`}
                    value={tag}
                    maxLength={24}
                    onChange={(event) => {
                      setTags((current) => current.map((value, tagIndex) => tagIndex === index ? event.target.value : value));
                      setSaved(false);
                    }}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-9 pr-3 text-sm outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  aria-label={`Remove tag ${index + 1}`}
                  onClick={() => { setTags((current) => current.filter((_, tagIndex) => tagIndex !== index)); setSaved(false); }}
                  className="rounded-xl border border-slate-700 px-3 text-slate-400 hover:border-red-500/50 hover:text-red-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          {tags.length < 5 && (
            <button
              type="button"
              onClick={() => { setTags((current) => [...current, '']); setSaved(false); }}
              className="mt-3 text-sm font-semibold text-indigo-300 hover:text-indigo-200"
            >
              + Add tag
            </button>
          )}
        </div>

        <div aria-live="polite">
          {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
          {saved && !error && (
            <p className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> Settings saved.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
        >
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

export default function GuildPublishing() {
  const [guilds, setGuilds] = useState<ManageableGuild[] | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchManageableGuilds(controller.signal)
      .then((result) => {
        setGuilds(result.guilds);
        setSelectedGuildId((current) => current ?? result.guilds[0]?.guildid ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const selectedGuild = useMemo(
    () => guilds?.find((guild) => guild.guildid === selectedGuildId) ?? null,
    [guilds, selectedGuildId],
  );

  const handleSaved = (updated: ManageableGuild) => {
    setGuilds((current) => current?.map((guild) => guild.guildid === updated.guildid ? updated : guild) ?? null);
  };

  return (
    <div className="space-y-6 pb-10">
      <header>
        <div className="mb-2 flex items-center gap-2 text-indigo-300">
          <ServerCog className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-[0.2em]">Guild Publishing</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Discord server publishing</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Configure only the active Go Study servers Discord currently lets you manage. Authorization refreshes when you sign in again.
        </p>
      </header>

      {failed ? (
        <p role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-300">
          Guild Publishing could not be loaded. Please retry after signing in again.
        </p>
      ) : guilds === null ? (
        <div className="flex min-h-48 items-center justify-center text-slate-400">
          <LoaderCircle className="mr-2 h-5 w-5 animate-spin" /> Loading manageable servers…
        </div>
      ) : guilds.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-[#18181b] p-8 text-center">
          <ServerCog className="mx-auto h-9 w-9 text-slate-600" />
          <h2 className="mt-3 font-semibold">No manageable Go Study servers</h2>
          <p className="mt-2 text-sm text-slate-500">You must own the Discord server or have Manage Server / Administrator, and the server must be active in Go Study.</p>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(300px,0.8fr)_minmax(420px,1.2fr)]">
          <section className="space-y-3" aria-label="Manageable Discord servers">
            {guilds.map((guild) => (
              <article
                key={guild.guildid}
                className={`rounded-2xl border p-4 transition ${selectedGuildId === guild.guildid ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-slate-800 bg-[#18181b]'}`}
              >
                <div className="flex items-center gap-4">
                  <DiscordGuildIcon guild={guild} size="compact" />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-semibold">{guild.name}</h2>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <Users className="h-3.5 w-3.5" /> {formatMembers(guild.memberCount)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-wider">
                      <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">Active</span>
                      <span className={`rounded-full px-2 py-1 ${guild.publication?.isPublic ? 'bg-indigo-500/20 text-indigo-200' : 'bg-slate-800 text-slate-400'}`}>
                        {guild.publication?.isPublic ? 'Public' : 'Hidden'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedGuildId(guild.guildid)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-indigo-500/60 hover:text-indigo-200"
                  >
                    Publication <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                  <Link
                    to={`/admin/servers/${guild.guildid}/board`}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-indigo-500/60 hover:text-indigo-200"
                  >
                    Edit Board <Paintbrush className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </article>
            ))}
          </section>

          {selectedGuild && <GuildEditor guild={selectedGuild} onSaved={handleSaved} />}
        </div>
      )}
    </div>
  );
}
