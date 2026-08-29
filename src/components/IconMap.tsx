import {
  BookOpen,
  Coffee,
  Film,
  HelpCircle,
  Image,
  Moon,
  ShieldCheck,
  Sparkles,
  Star,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';

import type {BoardShopItemType} from '../types';

const rewardAssetIcons: Readonly<Record<string, LucideIcon>> = {
  'rewards/coffee': Coffee,
  'rewards/books': BookOpen,
  'rewards/moon': Moon,
  'rewards/study-star': Star,
  'rewards/verified-hour-token': ShieldCheck,
};

export function renderRewardAsset(assetKey: string, className?: string) {
  const Icon = rewardAssetIcons[assetKey] ?? HelpCircle;
  return <Icon className={className} />;
}

const shopItemIcons: Readonly<Record<BoardShopItemType, LucideIcon>> = {
  decoration: Sparkles,
  sticky_note: StickyNote,
  gif: Film,
  photo_frame: Image,
};

export function renderShopItem(itemType: BoardShopItemType, className?: string) {
  const Icon = shopItemIcons[itemType];
  return <Icon className={className} />;
}
