import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {CheckCircle2, LoaderCircle, RefreshCw, ShoppingBag, WalletCards, X} from 'lucide-react';
import {motion} from 'motion/react';

import {ApiError} from '../api/productData';
import {fetchBoardShop, purchaseBoardShopItem} from '../api/shop';
import {useAuth} from '../auth/AuthProvider';
import {renderShopItem} from '../components/IconMap';
import type {
  BoardShopCatalogItem,
  BoardShopData,
  BoardShopPurchaseResult,
} from '../types';

interface PurchaseAttempt {
  item: BoardShopCatalogItem;
  requestId: string;
}

function chalkLabel(value: string): string {
  return `${value} Chalk`;
}

export default function Shop() {
  const {refresh} = useAuth();
  const [shop, setShop] = useState<BoardShopData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const [confirmationItem, setConfirmationItem] = useState<BoardShopCatalogItem | null>(null);
  const [attempt, setAttempt] = useState<PurchaseAttempt | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchased, setPurchased] = useState<BoardShopPurchaseResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadFailed(false);
    fetchBoardShop(controller.signal)
      .then(setShop)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          void refresh();
          return;
        }
        setLoadFailed(true);
      });
    return () => controller.abort();
  }, [refresh, requestVersion]);

  const runPurchase = async (purchaseAttempt: PurchaseAttempt) => {
    if (isPurchasing) return;
    setAttempt(purchaseAttempt);
    setIsPurchasing(true);
    setPurchaseError(null);
    setPurchased(null);
    try {
      const result = await purchaseBoardShopItem(
        purchaseAttempt.item.itemKey,
        purchaseAttempt.requestId,
      );
      setShop((current) => current ? {...current, chalkBalance: result.chalkBalance} : current);
      setPurchased(result);
      setAttempt(null);
      setConfirmationItem(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAttempt(null);
        await refresh();
      } else if (error instanceof ApiError && error.code === 'INSUFFICIENT_CHALK') {
        setAttempt(null);
        setPurchaseError(`You do not have enough Chalk for ${purchaseAttempt.item.displayName}.`);
      } else if (error instanceof ApiError && error.status < 500) {
        setAttempt(null);
        setPurchaseError('This purchase could not be completed. Refresh the shop and try again.');
      } else {
        setPurchaseError('The result is not confirmed. Retry safely with the same purchase request.');
      }
    } finally {
      setIsPurchasing(false);
    }
  };

  const confirmPurchase = () => {
    if (!confirmationItem || isPurchasing) return;
    const purchaseAttempt = attempt?.item.itemKey === confirmationItem.itemKey
      ? attempt
      : {item: confirmationItem, requestId: crypto.randomUUID()};
    void runPurchase(purchaseAttempt);
  };

  const closeConfirmation = () => {
    if (isPurchasing) return;
    setConfirmationItem(null);
    setAttempt(null);
    setPurchaseError(null);
  };

  return (
    <div className="space-y-8 pb-10">
      <header className="flex flex-col gap-5 border-b border-slate-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-300">
            <ShoppingBag className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-50">Board Shop</h1>
            <p className="text-sm text-slate-400">Purchase independent items for your evolving Study Board.</p>
          </div>
        </div>
        <div className="flex min-w-48 items-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-5 py-3">
          <WalletCards className="h-5 w-5 text-amber-300" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200/70">Chalk balance</p>
            <p className="text-2xl font-black text-amber-100">{shop?.chalkBalance ?? '—'}</p>
          </div>
        </div>
      </header>

      {loadFailed && !shop ? (
        <div className="rounded-2xl border border-slate-800 bg-[#18181b] p-10 text-center text-slate-400">
          <p>We could not load the Board Shop.</p>
          <button
            type="button"
            onClick={() => setRequestVersion((version) => version + 1)}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Try again
          </button>
        </div>
      ) : !shop ? (
        <div className="rounded-2xl border border-slate-800 bg-[#18181b] p-10 text-center text-slate-400">
          Loading the Board Shop…
        </div>
      ) : (
        <motion.div
          initial={{opacity: 0}}
          animate={{opacity: 1}}
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {shop.items.map((item, index) => (
            <motion.article
              key={item.itemKey}
              initial={{opacity: 0, y: 12}}
              animate={{opacity: 1, y: 0}}
              transition={{delay: index * 0.05}}
              className="group flex min-h-72 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#18181b] p-5 transition-colors hover:border-indigo-500/50"
            >
              <div className="mb-7 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-indigo-300 transition-transform group-hover:scale-105">
                {renderShopItem(item.itemType, 'h-8 w-8')}
              </div>
              <h2 className="text-lg font-bold text-slate-50">{item.displayName}</h2>
              <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">
                One owned item instance
              </p>
              <div className="mt-auto flex items-end justify-between gap-3 pt-7">
                <div>
                  <p className="text-2xl font-black text-white">{item.priceChalk}</p>
                  <p className="text-xs font-semibold text-amber-300">Chalk</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmationItem(item);
                    setAttempt(null);
                    setPurchaseError(null);
                    setPurchased(null);
                  }}
                  disabled={isPurchasing}
                  className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/15 transition-colors hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-50"
                >
                  Buy
                </button>
              </div>
            </motion.article>
          ))}
        </motion.div>
      )}

      {confirmationItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-confirmation-title"
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#18181b] p-6 shadow-2xl shadow-black/60"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-indigo-300">Confirm purchase</p>
                <h2 id="purchase-confirmation-title" className="mt-1 text-xl font-bold text-white">
                  {confirmationItem.displayName}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeConfirmation}
                disabled={isPurchasing}
                aria-label="Close purchase confirmation"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 flex items-center gap-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-300">
                {renderShopItem(confirmationItem.itemType, 'h-6 w-6')}
              </div>
              <div>
                <p className="font-semibold text-slate-100">One independent owned item</p>
                <p className="text-sm text-amber-300">{chalkLabel(confirmationItem.priceChalk)}</p>
              </div>
            </div>
            {purchaseError && <p role="alert" className="mt-4 text-sm text-red-300">{purchaseError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeConfirmation}
                disabled={isPurchasing}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={attempt ? () => void runPurchase(attempt) : confirmPurchase}
                disabled={isPurchasing}
                className="flex min-w-32 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
              >
                {isPurchasing ? (
                  <><LoaderCircle className="h-4 w-4 animate-spin" /> Purchasing…</>
                ) : attempt ? (
                  <><RefreshCw className="h-4 w-4" /> Retry safely</>
                ) : (
                  `Buy for ${confirmationItem.priceChalk}`
                )}
              </button>
            </div>
          </section>
        </div>
      )}

      {purchased && (
        <motion.section
          initial={{opacity: 0, y: 8}}
          animate={{opacity: 1, y: 0}}
          role="status"
          className="flex flex-col gap-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-7 w-7 text-emerald-300" />
            <div>
              <h2 className="font-bold text-emerald-100">Purchased {purchased.displayName}</h2>
              <p className="text-sm text-emerald-200/70">Owned item #{purchased.ownedItemId} is now in your Inventory.</p>
            </div>
          </div>
          <Link to="/inventory" className="text-sm font-bold text-emerald-200 hover:text-white hover:underline">
            View Inventory
          </Link>
        </motion.section>
      )}
    </div>
  );
}
