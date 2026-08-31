import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Expand,
  LoaderCircle,
  Paintbrush,
  RefreshCw,
  Save,
  Search,
  Smile,
  Sparkles,
  Sticker,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Link, useParams} from 'react-router-dom';

import {
  addAdminGuildBoardObject,
  deleteAdminGuildBoardObject,
  fetchAdminGuildBoard,
  fetchAdminGuildBoardAssets,
  GuildBoardsApiError,
  reorderAdminGuildBoardObject,
  saveAdminGuildBoardCapacity,
  saveAdminGuildBoardTheme,
  updateAdminGuildBoardObject,
} from '../api/guildBoards';
import {fetchManageableGuilds} from '../api/guildPublishing';
import {useAuth} from '../auth/AuthProvider';
import DiscordGuildIcon from '../components/DiscordGuildIcon';
import GuildBoardCanvas, {
  type GuildBoardCanvasHandle,
} from '../components/GuildBoardCanvas';
import {
  GUILD_BOARD_CAPACITIES,
  getGuildBoardCapacity,
  type GuildBoardCapacity,
} from '../guild-board-capacities';
import {
  GuildBoardMutationQueue,
  type GuildBoardMutationQueueHandlers,
  type GuildBoardQueuedMutationKind,
} from '../guild-board-interactions';
import {GUILD_BOARD_THEMES} from '../guild-board-themes';
import type {
  GuildBoard,
  GuildBoardAssetKind,
  GuildBoardAssets,
  GuildBoardEmojiAsset,
  GuildBoardObjectGeometry,
  GuildBoardStickerAsset,
  GuildBoardTheme,
  ManageableGuild,
} from '../types';

const DEFAULT_DECORATION_SIZE = 180;

type EditorState =
  | {status: 'loading'}
  | {status: 'ready'; guild: ManageableGuild; board: GuildBoard}
  | {status: 'error'};

type PickerAsset = (GuildBoardEmojiAsset | GuildBoardStickerAsset) & {
  kind: GuildBoardAssetKind;
};

const EMPTY_ASSETS: GuildBoardAssets = {emojis: [], stickers: []};

export default function GuildBoardEditor() {
  const {guildid = ''} = useParams();
  const {admin} = useAuth();
  const canvasRef = useRef<GuildBoardCanvasHandle>(null);
  const [state, setState] = useState<EditorState>({status: 'loading'});
  const [assets, setAssets] = useState<GuildBoardAssets>(EMPTY_ASSETS);
  const [theme, setTheme] = useState<GuildBoardTheme>('midnight');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<'saved' | 'conflict' | 'error' | null>(null);
  const [selectedCapacity, setSelectedCapacity] = useState<GuildBoardCapacity | null>(null);
  const [confirmingCapacity, setConfirmingCapacity] = useState(false);
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [capacityFeedback, setCapacityFeedback] = useState<'saved' | 'conflict' | 'forbidden' | 'error' | null>(null);
  const [pickerTab, setPickerTab] = useState<GuildBoardAssetKind>('emoji');
  const [search, setSearch] = useState('');
  const [objectMutationBusy, setObjectMutationBusy] = useState(false);
  const [placingAssetId, setPlacingAssetId] = useState<string | null>(null);
  const [objectFeedback, setObjectFeedback] = useState<'saved' | 'conflict' | 'rate-limited' | 'unavailable' | 'error' | null>(null);
  const [rateLimitCooldown, setRateLimitCooldown] = useState(false);
  const [requestKey, setRequestKey] = useState(0);
  const rateLimitUntilRef = useRef(0);
  const rateLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutationCallbacksRef = useRef<GuildBoardMutationQueueHandlers<GuildBoard>>({
    onBusyChange: () => undefined,
    onResult: () => undefined,
    onError: async () => null,
  });
  const objectMutationQueueRef = useRef<GuildBoardMutationQueue<GuildBoard> | null>(null);
  if (!objectMutationQueueRef.current) {
    objectMutationQueueRef.current = new GuildBoardMutationQueue<GuildBoard>({
      onBusyChange: (busy) => mutationCallbacksRef.current.onBusyChange(busy),
      onResult: (board) => mutationCallbacksRef.current.onResult(board),
      onSuccess: () => mutationCallbacksRef.current.onSuccess?.(),
      onError: (error) => mutationCallbacksRef.current.onError(error),
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    setState({status: 'loading'});
    setAssets(EMPTY_ASSETS);
    setFeedback(null);
    setCapacityFeedback(null);
    setObjectFeedback(null);
    setRateLimitCooldown(false);
    rateLimitUntilRef.current = 0;
    if (rateLimitTimerRef.current) clearTimeout(rateLimitTimerRef.current);
    setSelectedCapacity(null);
    setConfirmingCapacity(false);
    Promise.all([
      fetchManageableGuilds(controller.signal),
      fetchAdminGuildBoard(guildid, controller.signal),
      fetchAdminGuildBoardAssets(guildid, controller.signal),
    ])
      .then(([response, board, nextAssets]) => {
        const guild = response.guilds.find((candidate) => candidate.guildid === guildid);
        if (!guild) throw new Error('Manageable guild was not returned');
        setTheme(board.theme);
        setAssets(nextAssets);
        objectMutationQueueRef.current?.setCurrent(board);
        setState({status: 'ready', guild, board});
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({status: 'error'});
      });
    return () => controller.abort();
  }, [guildid, requestKey]);

  const applyCanonicalBoard = useCallback((board: GuildBoard) => {
    objectMutationQueueRef.current?.setCurrent(board);
    setState((current) => current.status === 'ready'
      ? {...current, board}
      : current);
    setTheme(board.theme);
  }, []);

  const reloadCanonicalBoard = useCallback(async () => {
    const board = await fetchAdminGuildBoard(guildid);
    applyCanonicalBoard(board);
    return board;
  }, [applyCanonicalBoard, guildid]);

  const beginRateLimitCooldown = useCallback((retryAfterSeconds: number | null) => {
    const seconds = Math.max(1, retryAfterSeconds ?? 1);
    rateLimitUntilRef.current = Date.now() + seconds * 1000;
    setRateLimitCooldown(true);
    if (rateLimitTimerRef.current) clearTimeout(rateLimitTimerRef.current);
    rateLimitTimerRef.current = setTimeout(() => {
      rateLimitUntilRef.current = 0;
      setRateLimitCooldown(false);
      rateLimitTimerRef.current = null;
    }, seconds * 1000);
  }, []);

  useEffect(() => () => {
    if (rateLimitTimerRef.current) clearTimeout(rateLimitTimerRef.current);
  }, []);

  const reconcileObjectMutationError = useCallback(async (error: unknown) => {
    if (error instanceof GuildBoardsApiError
      && error.status === 429
      && error.code === 'RATE_LIMITED') {
      beginRateLimitCooldown(error.retryAfterSeconds);
      try {
        const board = await fetchAdminGuildBoard(guildid);
        setObjectFeedback('rate-limited');
        return board;
      } catch {
        setObjectFeedback('rate-limited');
        return null;
      }
    }
    if (error instanceof GuildBoardsApiError
      && error.code === 'GUILD_BOARD_REVISION_CONFLICT') {
      try {
        const board = await fetchAdminGuildBoard(guildid);
        setObjectFeedback('conflict');
        return board;
      } catch {
        setObjectFeedback('error');
        return null;
      }
    }
    if (error instanceof GuildBoardsApiError
      && error.code === 'GUILD_BOARD_ASSET_UNAVAILABLE') {
      setObjectFeedback('unavailable');
    } else {
      setObjectFeedback('error');
    }
    return null;
  }, [beginRateLimitCooldown, guildid]);

  mutationCallbacksRef.current = {
    onBusyChange: (busy) => {
      setObjectMutationBusy(busy);
      if (!busy) setPlacingAssetId(null);
    },
    onResult: applyCanonicalBoard,
    onSuccess: () => setObjectFeedback('saved'),
    onError: reconcileObjectMutationError,
  };

  const handleSave = async () => {
    if (state.status !== 'ready'
      || objectMutationQueueRef.current?.isBusy
      || rateLimitUntilRef.current > Date.now()) return;
    setSaving(true);
    setFeedback(null);
    try {
      const board = await saveAdminGuildBoardTheme(guildid, {
        theme,
        expectedRevision: state.board.revision,
      });
      applyCanonicalBoard(board);
      setFeedback('saved');
    } catch (error) {
      if (error instanceof GuildBoardsApiError
        && error.code === 'GUILD_BOARD_REVISION_CONFLICT') {
        try {
          await reloadCanonicalBoard();
          setFeedback('conflict');
        } catch {
          setFeedback('error');
        }
      } else {
        setFeedback('error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCapacityExpansion = async () => {
    if (state.status !== 'ready'
      || !selectedCapacity
      || admin?.role !== 'owner'
      || objectMutationQueueRef.current?.isBusy
      || rateLimitUntilRef.current > Date.now()) return;
    setSavingCapacity(true);
    setCapacityFeedback(null);
    try {
      const board = await saveAdminGuildBoardCapacity(guildid, {
        width: selectedCapacity.width,
        height: selectedCapacity.height,
        expectedRevision: state.board.revision,
      });
      applyCanonicalBoard(board);
      setSelectedCapacity(null);
      setConfirmingCapacity(false);
      setCapacityFeedback('saved');
    } catch (error) {
      if (error instanceof GuildBoardsApiError
        && error.code === 'GUILD_BOARD_REVISION_CONFLICT') {
        try {
          await reloadCanonicalBoard();
          setCapacityFeedback('conflict');
        } catch {
          setCapacityFeedback('error');
        }
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

  const runObjectMutation = useCallback((
    mutate: (current: GuildBoard) => Promise<GuildBoard>,
    kind: GuildBoardQueuedMutationKind = 'mutation',
    coalesceKey?: string,
  ) => {
    if (state.status !== 'ready'
      || saving
      || savingCapacity
      || rateLimitUntilRef.current > Date.now()) return Promise.resolve();
    setObjectFeedback(null);
    return objectMutationQueueRef.current?.enqueue({kind, coalesceKey, run: mutate})
      ?? Promise.resolve();
  }, [saving, savingCapacity, state.status]);

  const handlePlaceAsset = (asset: PickerAsset) => {
    if (state.status !== 'ready'
      || objectMutationBusy
      || rateLimitCooldown
      || saving
      || savingCapacity) return;
    const center = canvasRef.current?.getVisibleCenter() ?? {
      x: state.board.width / 2,
      y: state.board.height / 2,
    };
    const x = Math.round(Math.min(
      state.board.width - DEFAULT_DECORATION_SIZE,
      Math.max(0, center.x - DEFAULT_DECORATION_SIZE / 2),
    ));
    const y = Math.round(Math.min(
      state.board.height - DEFAULT_DECORATION_SIZE,
      Math.max(0, center.y - DEFAULT_DECORATION_SIZE / 2),
    ));
    setPlacingAssetId(asset.id);
    void runObjectMutation((current) => addAdminGuildBoardObject(guildid, {
      assetKind: asset.kind,
      assetId: asset.id,
      x,
      y,
      size: DEFAULT_DECORATION_SIZE,
      rotation: 0,
      expectedRevision: current.revision,
    }));
  };

  const handleTransform = useCallback((
    objectId: string,
    geometry: Pick<GuildBoardObjectGeometry, 'x' | 'y' | 'size' | 'rotation'>,
  ) => runObjectMutation(
    (current) => updateAdminGuildBoardObject(
      guildid,
      objectId,
      {...geometry, expectedRevision: current.revision},
    ),
    'transform',
    objectId,
  ), [guildid, runObjectMutation]);

  const handleLayer = useCallback((objectId: string, action: 'front' | 'back') => (
    runObjectMutation((current) => reorderAdminGuildBoardObject(
      guildid,
      objectId,
      {action, expectedRevision: current.revision},
    ))
  ), [guildid, runObjectMutation]);

  const handleDelete = useCallback((objectId: string) => (
    runObjectMutation((current) => deleteAdminGuildBoardObject(
      guildid,
      objectId,
      current.revision,
    ))
  ), [guildid, runObjectMutation]);

  const pickerAssets = useMemo<PickerAsset[]>(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    const source = pickerTab === 'emoji'
      ? assets.emojis.map((asset) => ({...asset, kind: 'emoji' as const}))
      : assets.stickers.map((asset) => ({...asset, kind: 'sticker' as const}));
    return normalizedSearch
      ? source.filter((asset) => asset.name.toLocaleLowerCase().includes(normalizedSearch))
      : source;
  }, [assets.emojis, assets.stickers, pickerTab, search]);

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
  const boardInteractionBlocked = objectMutationBusy
    || rateLimitCooldown
    || saving
    || savingCapacity;

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

      <div className="grid gap-7 xl:grid-cols-[minmax(300px,0.68fr)_minmax(0,1.32fr)]">
        <div className="space-y-7">
          <section className="rounded-[28px] border border-slate-800 bg-[#18181b] p-6" aria-labelledby="board-assets-heading">
            <div className="flex items-center gap-3">
              <DiscordGuildIcon guild={guild} size="compact" />
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">Decorations</p>
                <h2 id="board-assets-heading" className="truncate text-xl font-black">{guild.name}</h2>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">Place this server’s own synced artwork near the center of your current board view.</p>

            <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-slate-950/70 p-1" role="tablist" aria-label="Decoration type">
              <button type="button" role="tab" aria-selected={pickerTab === 'emoji'} onClick={() => setPickerTab('emoji')} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${pickerTab === 'emoji' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}><Smile className="h-4 w-4" /> Emoji</button>
              <button type="button" role="tab" aria-selected={pickerTab === 'sticker'} onClick={() => setPickerTab('sticker')} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${pickerTab === 'sticker' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}><Sticker className="h-4 w-4" /> Stickers</button>
            </div>

            <label className="mt-4 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/60 px-3 focus-within:border-indigo-400">
              <Search className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <span className="sr-only">Search {pickerTab}</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder={`Search ${pickerTab === 'emoji' ? 'emoji' : 'stickers'}`} className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-slate-600" />
            </label>

            <div className="mt-4 grid max-h-72 grid-cols-5 gap-2 overflow-y-auto pr-1 sm:grid-cols-7 xl:grid-cols-5" role="tabpanel">
              {pickerAssets.map((asset) => (
                <button
                  key={`${asset.kind}:${asset.id}`}
                  type="button"
                  title={asset.name}
                  aria-label={`Place ${asset.name} ${asset.kind}`}
                  disabled={boardInteractionBlocked}
                  onClick={() => handlePlaceAsset(asset)}
                  className="group relative aspect-square rounded-xl border border-slate-700 bg-slate-950/60 p-2 hover:border-indigo-400 hover:bg-indigo-500/10 disabled:cursor-wait disabled:opacity-50"
                >
                  <img src={asset.url} alt="" draggable={false} className="h-full w-full object-contain drop-shadow-md" onError={(event) => { event.currentTarget.hidden = true; }} />
                  {placingAssetId === asset.id && <LoaderCircle className="absolute inset-0 m-auto h-5 w-5 animate-spin text-indigo-200" />}
                </button>
              ))}
            </div>
            {pickerAssets.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">No available {pickerTab === 'emoji' ? 'emoji' : 'image-renderable stickers'} match this search.</p>}
            {pickerTab === 'sticker' && <p className="mt-3 text-xs leading-5 text-slate-600">PNG, APNG, and GIF stickers are supported. Discord Lottie stickers are excluded in this version.</p>}

            <div className="mt-4" aria-live="polite">
              {objectFeedback === 'saved' && <p className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Board saved at revision {board.revision}.</p>}
              {objectFeedback === 'conflict' && <p role="alert" className="text-sm text-amber-200">Another editor changed this board. The latest board has been reloaded; your change was not overwritten.</p>}
              {objectFeedback === 'rate-limited' && <p role="alert" className="text-sm text-amber-200">Board editing is temporarily rate-limited. The latest board has been reloaded; wait for the cooldown before editing again.</p>}
              {objectFeedback === 'unavailable' && <p role="alert" className="text-sm text-amber-200">That Discord asset is no longer available to place.</p>}
              {objectFeedback === 'error' && <p role="alert" className="text-sm text-red-300">The decoration change could not be saved.</p>}
            </div>
          </section>

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

            <div className="mt-5" aria-live="polite">
              {feedback === 'saved' && <p className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Theme saved at revision {board.revision}.</p>}
              {feedback === 'conflict' && <p role="alert" className="text-sm text-amber-200">This board changed in another editor. The latest revision has been reloaded.</p>}
              {feedback === 'error' && <p role="alert" className="text-sm text-red-300">The theme could not be saved. Please try again.</p>}
            </div>

            <button type="button" onClick={() => void handleSave()} disabled={boardInteractionBlocked || theme === board.theme} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
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
                      <button key={capacity.key} type="button" aria-pressed={selectedCapacity?.key === capacity.key} onClick={() => { setSelectedCapacity(capacity); setConfirmingCapacity(false); setCapacityFeedback(null); }} className={`rounded-xl border p-3 text-left ${selectedCapacity?.key === capacity.key ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-700 bg-slate-950/50 hover:border-slate-500'}`}>
                        <span className="block font-bold">{capacity.label}</span>
                        <span className="mt-1 block font-mono text-xs text-slate-500">{capacity.width.toLocaleString()} × {capacity.height.toLocaleString()} units</span>
                      </button>
                    ))}
                  </div>
                ) : <p className="mt-4 text-sm font-semibold text-emerald-300">This board is at maximum capacity.</p>}

                {selectedCapacity && !confirmingCapacity && <button type="button" onClick={() => setConfirmingCapacity(true)} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/50 px-4 py-3 text-sm font-bold text-indigo-200 hover:bg-indigo-500/10"><Expand className="h-4 w-4" /> Review expansion</button>}
                {selectedCapacity && confirmingCapacity && (
                  <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <p className="text-sm font-bold text-amber-100">Confirm permanent expansion to {selectedCapacity.label}?</p>
                    <p className="mt-1 text-xs leading-5 text-amber-200/75">This adds space to the right and bottom. It cannot be reversed from this editor.</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" disabled={savingCapacity} onClick={() => setConfirmingCapacity(false)} className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold">Cancel</button>
                      <button type="button" disabled={boardInteractionBlocked} onClick={() => void handleCapacityExpansion()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-xs font-black text-amber-950 disabled:opacity-60">{savingCapacity && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />} Confirm expansion</button>
                    </div>
                  </div>
                )}
              </>
            ) : <p className="mt-4 text-sm leading-6 text-slate-500">Capacity is read-only. Only the Go Study platform owner can expand this finite board.</p>}

            <div className="mt-4" aria-live="polite">
              {capacityFeedback === 'saved' && <p className="text-sm text-emerald-300">Board capacity expanded successfully.</p>}
              {capacityFeedback === 'conflict' && <p role="alert" className="text-sm text-amber-200">The board changed before expansion. The latest revision has been reloaded.</p>}
              {capacityFeedback === 'forbidden' && <p role="alert" className="text-sm text-red-300">Only the Go Study platform owner may expand capacity.</p>}
              {capacityFeedback === 'error' && <p role="alert" className="text-sm text-red-300">The board capacity could not be expanded.</p>}
            </div>
          </section>
        </div>

        <section className="min-w-0 self-start rounded-[28px] border border-slate-800 bg-[#18181b] p-4 sm:p-5 xl:sticky xl:top-6" aria-labelledby="board-preview-heading">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-indigo-300"><Sparkles className="h-4 w-4" /> Live editor</p>
              <h2 id="board-preview-heading" className="mt-1 text-xl font-black">Public Study Board</h2>
            </div>
            <span className="rounded-full bg-slate-950 px-3 py-1 font-mono text-[11px] text-slate-500">rev {board.revision}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">Select artwork to move it. Resize and rotate handles appear only on the selected decoration. Drag empty space, hold Space, or use the middle mouse button to pan.</p>
          <GuildBoardCanvas
            ref={canvasRef}
            theme={theme}
            width={board.width}
            height={board.height}
            objects={board.objects}
            editable
            mutationBusy={boardInteractionBlocked}
            interactionDisabled={rateLimitCooldown || saving || savingCapacity}
            onTransform={handleTransform}
            onLayer={handleLayer}
            onDelete={handleDelete}
            className="mt-4"
          />
        </section>
      </div>
    </div>
  );
}
