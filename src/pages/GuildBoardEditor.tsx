import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Expand,
  LoaderCircle,
  Paintbrush,
  RefreshCw,
  Save,
} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Link, useParams} from 'react-router-dom';

import {
  fetchAdminGuildBoard,
  GuildBoardsApiError,
  saveAdminGuildBoardCapacity,
  saveAdminGuildBoardTheme,
} from '../api/guildBoards';
import {fetchManageableGuilds} from '../api/guildPublishing';
import {useAuth} from '../auth/AuthProvider';
import DiscordGuildIcon from '../components/DiscordGuildIcon';
import GuildBoardCanvas from '../components/GuildBoardCanvas';
import {
  GUILD_BOARD_CAPACITIES,
  getGuildBoardCapacity,
  type GuildBoardCapacity,
} from '../guild-board-capacities';
import {GUILD_BOARD_THEMES} from '../guild-board-themes';
import type {GuildBoard, GuildBoardTheme, ManageableGuild} from '../types';

type EditorState =
  | {status: 'loading'}
  | {status: 'ready'; guild: ManageableGuild; board: GuildBoard}
  | {status: 'error'};

export default function GuildBoardEditor() {
  const {guildid = ''} = useParams();
  const {admin} = useAuth();
  const [state, setState] = useState<EditorState>({status: 'loading'});
  const [theme, setTheme] = useState<GuildBoardTheme>('midnight');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<'saved' | 'conflict' | 'error' | null>(null);
  const [selectedCapacity, setSelectedCapacity] = useState<GuildBoardCapacity | null>(null);
  const [confirmingCapacity, setConfirmingCapacity] = useState(false);
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [capacityFeedback, setCapacityFeedback] = useState<'saved' | 'conflict' | 'forbidden' | 'error' | null>(null);
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({status: 'loading'});
    setFeedback(null);
    setCapacityFeedback(null);
    setSelectedCapacity(null);
    setConfirmingCapacity(false);
    Promise.all([
      fetchManageableGuilds(controller.signal),
      fetchAdminGuildBoard(guildid, controller.signal),
    ])
      .then(([response, board]) => {
        const guild = response.guilds.find((candidate) => candidate.guildid === guildid);
        if (!guild) throw new Error('Manageable guild was not returned');
        setTheme(board.theme);
        setState({status: 'ready', guild, board});
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({status: 'error'});
      });
    return () => controller.abort();
  }, [guildid, requestKey]);

  const handleSave = async () => {
    if (state.status !== 'ready') return;
    setSaving(true);
    setFeedback(null);
    try {
      const board = await saveAdminGuildBoardTheme(guildid, {
        theme,
        expectedRevision: state.board.revision,
      });
      setState({...state, board});
      setTheme(board.theme);
      setFeedback('saved');
    } catch (error) {
      setFeedback(error instanceof GuildBoardsApiError
        && error.code === 'GUILD_BOARD_REVISION_CONFLICT'
        ? 'conflict'
        : 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCapacityExpansion = async () => {
    if (state.status !== 'ready' || !selectedCapacity || admin?.role !== 'owner') return;
    setSavingCapacity(true);
    setCapacityFeedback(null);
    try {
      const board = await saveAdminGuildBoardCapacity(guildid, {
        width: selectedCapacity.width,
        height: selectedCapacity.height,
        expectedRevision: state.board.revision,
      });
      setState({...state, board});
      setTheme(board.theme);
      setSelectedCapacity(null);
      setConfirmingCapacity(false);
      setCapacityFeedback('saved');
    } catch (error) {
      if (error instanceof GuildBoardsApiError
        && error.code === 'GUILD_BOARD_REVISION_CONFLICT') {
        setCapacityFeedback('conflict');
      } else if (error instanceof GuildBoardsApiError
        && error.code === 'GUILD_BOARD_CAPACITY_FORBIDDEN') {
        setCapacityFeedback('forbidden');
      } else {
        setCapacityFeedback('error');
      }
    } finally {
      setSavingCapacity(false);
    }
  };

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-[55vh] items-center justify-center text-slate-400" aria-live="polite">
        <LoaderCircle className="mr-3 h-5 w-5 animate-spin" /> Loading board editor…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto flex min-h-[55vh] max-w-xl flex-col items-center justify-center text-center" role="alert">
        <AlertTriangle className="h-9 w-9 text-red-300" />
        <h1 className="mt-4 text-2xl font-bold">Board editor unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">The server may be inactive, or your Discord management authorization may need to be refreshed by signing in again.</p>
        <button type="button" onClick={() => setRequestKey((value) => value + 1)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-950">
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  const {guild, board} = state;
  const currentCapacity = getGuildBoardCapacity(board.width, board.height);
  const currentCapacityIndex = GUILD_BOARD_CAPACITIES.findIndex(
    (capacity) => capacity.key === currentCapacity.key,
  );
  const expansionChoices = GUILD_BOARD_CAPACITIES.slice(currentCapacityIndex + 1);
  return (
    <div className="space-y-7 pb-10">
      <Link to="/admin/servers" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Publishing settings
      </Link>

      <header className="overflow-hidden rounded-[28px] border border-slate-800 bg-[#18181b]">
        <div className="bg-gradient-to-br from-indigo-950/90 via-slate-950 to-violet-950/80 p-6 sm:p-8">
          <div className="flex items-center gap-5">
            <DiscordGuildIcon guild={guild} size="card" />
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-indigo-300"><Paintbrush className="h-4 w-4" /> Board editor</p>
              <h1 className="mt-2 truncate text-2xl font-black sm:text-3xl">{guild.name}</h1>
              <p className="mt-1 font-mono text-xs text-slate-500">{guild.guildid}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-7 xl:grid-cols-[minmax(280px,0.62fr)_minmax(0,1.38fr)]">
        <div className="space-y-7">
        <section className="rounded-[28px] border border-slate-800 bg-[#18181b] p-6" aria-labelledby="board-theme-heading">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">Appearance</p>
          <h2 id="board-theme-heading" className="mt-2 text-xl font-black">Choose a board theme</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Themes are a fixed, safe set of CSS-only surfaces shared by the editor and public page.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
            {GUILD_BOARD_THEMES.map((option) => {
              const selected = option.key === theme;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => { setTheme(option.key); setFeedback(null); }}
                  className={`rounded-2xl border p-4 text-left transition ${selected ? 'border-indigo-400 bg-indigo-500/12 ring-2 ring-indigo-500/20' : 'border-slate-700 bg-slate-950/50 hover:border-slate-500'}`}
                >
                  <span className={`guild-board-theme-swatch block h-12 rounded-xl border border-black/10 ${option.className}`} />
                  <span className="mt-3 block font-bold">{option.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>
                </button>
              );
            })}
          </div>

          <p className="mt-5 rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-xs leading-5 text-slate-400">
            Discord emoji and sticker placement arrives in the next chapter.
          </p>

          <div className="mt-5" aria-live="polite">
            {feedback === 'saved' && <p className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Theme saved at revision {board.revision}.</p>}
            {feedback === 'conflict' && (
              <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                This board changed in another editor. Reload it before saving again.
                <button type="button" onClick={() => setRequestKey((value) => value + 1)} className="mt-3 flex items-center gap-2 font-bold text-amber-100 underline underline-offset-4"><RefreshCw className="h-4 w-4" /> Reload latest board</button>
              </div>
            )}
            {feedback === 'error' && <p role="alert" className="text-sm text-red-300">The theme could not be saved. Please try again.</p>}
          </div>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || theme === board.theme}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save Theme'}
          </button>
        </section>

        <section className="rounded-[28px] border border-slate-800 bg-[#18181b] p-6" aria-labelledby="board-capacity-heading">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">Finite canvas</p>
          <h2 id="board-capacity-heading" className="mt-2 text-xl font-black">Board capacity</h2>
          <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-bold">{currentCapacity.label}</p>
                <p className="mt-1 text-xs text-slate-500">Current capacity · revision {board.revision}</p>
              </div>
              <span className="font-mono text-sm text-indigo-200">{board.width.toLocaleString()} × {board.height.toLocaleString()}</span>
            </div>
          </div>

          {admin?.role === 'owner' ? (
            <>
              <p className="mt-4 text-sm leading-6 text-slate-500">Expansion adds permanent space to the right and bottom. Existing coordinates never move, and shrinking is unavailable.</p>
              {expansionChoices.length > 0 ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                  {expansionChoices.map((capacity) => (
                    <button
                      key={capacity.key}
                      type="button"
                      aria-pressed={selectedCapacity?.key === capacity.key}
                      onClick={() => {
                        setSelectedCapacity(capacity);
                        setConfirmingCapacity(false);
                        setCapacityFeedback(null);
                      }}
                      className={`rounded-xl border p-3 text-left ${selectedCapacity?.key === capacity.key ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-700 bg-slate-950/50 hover:border-slate-500'}`}
                    >
                      <span className="block font-bold">{capacity.label}</span>
                      <span className="mt-1 block font-mono text-xs text-slate-500">{capacity.width.toLocaleString()} × {capacity.height.toLocaleString()} units</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm font-semibold text-emerald-300">This board is at maximum capacity.</p>
              )}

              {selectedCapacity && !confirmingCapacity && (
                <button type="button" onClick={() => setConfirmingCapacity(true)} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/50 px-4 py-3 text-sm font-bold text-indigo-200 hover:bg-indigo-500/10">
                  <Expand className="h-4 w-4" /> Review expansion
                </button>
              )}
              {selectedCapacity && confirmingCapacity && (
                <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <p className="text-sm font-bold text-amber-100">Confirm permanent expansion to {selectedCapacity.label}?</p>
                  <p className="mt-1 text-xs leading-5 text-amber-200/75">This adds space to the right and bottom. It cannot be reversed from this editor.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" disabled={savingCapacity} onClick={() => setConfirmingCapacity(false)} className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold">Cancel</button>
                    <button type="button" disabled={savingCapacity} onClick={() => void handleCapacityExpansion()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-xs font-black text-amber-950 disabled:opacity-60">
                      {savingCapacity && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />} Confirm expansion
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="mt-4 text-sm leading-6 text-slate-500">Capacity is read-only. Only the Go Study platform owner can expand this finite board.</p>
          )}

          <div className="mt-4" aria-live="polite">
            {capacityFeedback === 'saved' && <p className="text-sm text-emerald-300">Board capacity expanded successfully.</p>}
            {capacityFeedback === 'conflict' && <p role="alert" className="text-sm text-amber-200">The board changed before expansion. Reload the latest revision and try again.</p>}
            {capacityFeedback === 'forbidden' && <p role="alert" className="text-sm text-red-300">Only the Go Study platform owner may expand capacity.</p>}
            {capacityFeedback === 'error' && <p role="alert" className="text-sm text-red-300">The board capacity could not be expanded.</p>}
          </div>
        </section>
        </div>

        <section className="min-w-0 rounded-[28px] border border-slate-800 bg-[#18181b] p-4 sm:p-5" aria-labelledby="board-preview-heading">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">Live preview</p>
              <h2 id="board-preview-heading" className="mt-1 text-xl font-black">Public Study Board</h2>
            </div>
            <span className="rounded-full bg-slate-950 px-3 py-1 font-mono text-[11px] text-slate-500">rev {board.revision}</span>
          </div>
          <GuildBoardCanvas
            theme={theme}
            width={board.width}
            height={board.height}
            objects={[]}
            className="mt-4"
          />
        </section>
      </div>
    </div>
  );
}
