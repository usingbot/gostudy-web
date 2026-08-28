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
}

export interface DashboardData {
  verifiedSeconds: number;
  completedHours: number;
  progressSeconds: number;
  secondsToNextMilestone: number;
  recentInventory: InventoryItem[];
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
