import {
  BookOpen,
  Coffee,
  HelpCircle,
  Moon,
  ShieldCheck,
  Star,
  type LucideIcon,
} from 'lucide-react';

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
