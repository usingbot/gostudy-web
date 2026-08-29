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

export type UserRole = 'owner' | 'admin' | 'tester' | 'user';

export interface RoleCapabilities {
  accessAdmin: boolean;
  searchUsers: boolean;
  viewChalk: boolean;
  adjustChalk: boolean;
  manageTester: boolean;
  manageAdmin: boolean;
  manageOwner: false;
}

export interface AdminSelf {
  role: UserRole;
  capabilities: RoleCapabilities;
}

export interface KnownDiscordIdentity {
  username: string;
  globalName: string | null;
  avatarHash: string | null;
}

export interface AdminUserSummary {
  userid: string;
  identity: KnownDiscordIdentity | null;
  role: UserRole;
}

export interface ChalkAccount {
  userid: string;
  balance: string;
  lifetimeCredited: string;
  lifetimeDebited: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ChalkTransaction {
  transactionId: string;
  userid: string;
  amount: string;
  balanceAfter: string;
  transactionType: string;
  actorUserId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface ChalkHistoryPage {
  items: ChalkTransaction[];
  nextCursor: string | null;
}

export interface AdminUserDetail extends AdminUserSummary {
  manageableRoles: UserRole[];
  chalkAccount: ChalkAccount;
  chalkHistory: ChalkHistoryPage;
}

export interface RoleAuditEvent {
  auditId: string;
  targetUserId: string;
  oldRole: UserRole;
  newRole: UserRole;
  actorUserId: string | null;
  changeSource: 'bootstrap' | 'admin';
  reason: string;
  createdAt: string;
}

export interface RoleAuditPage {
  items: RoleAuditEvent[];
  nextCursor: string | null;
}

export interface ChalkMutationResult {
  transaction: ChalkTransaction;
  account: ChalkAccount;
  replayed: boolean;
}

export interface RoleChangeResult {
  userid: string;
  oldRole: UserRole;
  newRole: UserRole;
  changed: boolean;
  changedAt: string | null;
}
