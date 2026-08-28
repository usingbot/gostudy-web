export interface InventoryItem {
  hourRewardId: string;
  milestoneHour: number;
  earnedAt: string;
  grantedAt: string;
  itemKey: string;
  displayName: string;
  description: string | null;
  assetKey: string;
  metadata: Record<string, unknown>;
  isNew: boolean;
}

export interface DashboardData {
  verifiedSeconds: number;
  completedHours: number;
  progressSeconds: number;
  secondsToNextMilestone: number;
  recentInventory: InventoryItem[];
  newRewardCount: number;
}

export interface InventoryPage {
  items: InventoryItem[];
  nextCursor: string | null;
}

export interface CatalogItem {
  itemKey: string;
  displayName: string;
  description: string | null;
  assetKey: string;
  metadata: Record<string, unknown>;
  active: boolean;
}

export interface BoardPosition {
  x: number;
  y: number;
}

export interface BoardItem extends Omit<InventoryItem, 'isNew'>, BoardPosition {}

export interface BoardData {
  items: BoardItem[];
}
