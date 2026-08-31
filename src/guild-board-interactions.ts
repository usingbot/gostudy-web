export type GuildBoardQueuedMutationKind = 'mutation' | 'transform';

export interface GuildBoardQueuedMutation<T> {
  kind: GuildBoardQueuedMutationKind;
  coalesceKey?: string;
  run(current: T): Promise<T>;
}

export interface GuildBoardMutationQueueHandlers<T> {
  onBusyChange(busy: boolean): void;
  onResult(value: T): void;
  onSuccess?(): void;
  onError(error: unknown): Promise<T | null>;
}

interface PendingMutation<T> {
  mutation: GuildBoardQueuedMutation<T>;
  resolve: Array<() => void>;
}

/**
 * Keeps optimistic board revisions in one request lane. Consecutive pending
 * transforms for the same object collapse to the latest geometry, while every
 * caller is released only after that latest request has settled.
 */
export class GuildBoardMutationQueue<T> {
  private current: T | null = null;
  private pending: Array<PendingMutation<T>> = [];
  private running = false;

  constructor(private readonly handlers: GuildBoardMutationQueueHandlers<T>) {}

  get isBusy(): boolean {
    return this.running;
  }

  setCurrent(value: T): void {
    this.current = value;
  }

  enqueue(mutation: GuildBoardQueuedMutation<T>): Promise<void> {
    const completion = new Promise<void>((resolve) => {
      const last = this.pending.at(-1);
      if (mutation.kind === 'transform'
        && mutation.coalesceKey
        && last?.mutation.kind === 'transform'
        && last.mutation.coalesceKey === mutation.coalesceKey) {
        last.mutation = mutation;
        last.resolve.push(resolve);
      } else {
        this.pending.push({mutation, resolve: [resolve]});
      }
    });
    void this.drain();
    return completion;
  }

  private resolvePending(): void {
    for (const pending of this.pending.splice(0)) {
      for (const resolve of pending.resolve) resolve();
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.handlers.onBusyChange(true);
    try {
      while (this.pending.length > 0) {
        const pending = this.pending.shift();
        if (!pending) break;
        if (!this.current) {
          for (const resolve of pending.resolve) resolve();
          this.resolvePending();
          break;
        }
        try {
          const next = await pending.mutation.run(this.current);
          this.current = next;
          this.handlers.onResult(next);
          this.handlers.onSuccess?.();
          for (const resolve of pending.resolve) resolve();
        } catch (error) {
          try {
            const canonical = await this.handlers.onError(error);
            if (canonical) {
              this.current = canonical;
              this.handlers.onResult(canonical);
            }
          } catch {
            // The error handler owns user-facing feedback for reconciliation failures.
          }
          for (const resolve of pending.resolve) resolve();
          // Never automatically replay gestures made against an uncertain revision.
          this.resolvePending();
          break;
        }
      }
    } finally {
      this.running = false;
      this.handlers.onBusyChange(false);
    }
  }
}

/** Marks a physical pointer gesture settled before invoking persistence. */
export class GuildBoardGestureCommitGuard {
  private nextGestureId = 1;
  private lastSettledGestureId = 0;

  begin(): number {
    const gestureId = this.nextGestureId;
    this.nextGestureId += 1;
    return gestureId;
  }

  settle(
    gestureId: number,
    shouldPersist: boolean,
    persist: () => void | Promise<void>,
  ): Promise<void> | null {
    if (gestureId <= this.lastSettledGestureId) return null;
    this.lastSettledGestureId = gestureId;
    if (!shouldPersist) return null;
    return Promise.resolve().then(persist);
  }
}
