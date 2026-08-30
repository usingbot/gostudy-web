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
  shopItems: ShopInventoryItem[];
  nextCursor: string | null;
}

export type BoardShopItemType = 'decoration' | 'sticky_note' | 'gif' | 'photo_frame';

export interface ShopInventoryItem {
  source: 'shop';
  ownedItemId: string;
  itemKey: string;
  displayName: string;
  itemType: BoardShopItemType;
  acquiredAt: string;
}

export interface BoardShopCatalogItem {
  itemKey: string;
  displayName: string;
  itemType: BoardShopItemType;
  priceChalk: string;
  enabled: boolean;
}

export interface BoardShopData {
  chalkBalance: string;
  items: BoardShopCatalogItem[];
}

export interface BoardShopPurchaseResult {
  purchaseId: string;
  userId: string;
  itemKey: string;
  displayName: string;
  itemType: BoardShopItemType;
  priceChalk: string;
  ownedItemId: string;
  chalkTransactionId: string;
  chalkBalance: string;
  replayed: boolean;
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

interface BoardObjectBase extends BoardPosition {
  boardObjectId: string;
}

export interface RewardBoardObject extends Omit<InventoryItem, 'isNew'>, BoardObjectBase {
  source: 'reward';
}

export interface ShopBoardObject extends BoardObjectBase {
  source: 'shop';
  ownedItemId: string;
  itemKey: string;
  displayName: string;
  itemType: BoardShopItemType;
  body?: string;
  gif?: BoardGif | null;
  photo?: BoardPhoto | null;
}

export type BoardObject = RewardBoardObject | ShopBoardObject;

export interface BoardPositionResult extends BoardPosition {
  boardObjectId: string;
}

export interface StickyNoteContent {
  ownedItemId: string;
  body: string;
}

export interface BoardGif {
  giphyId: string;
  title: string;
  media: BoardGifMedia | null;
  hydrationState: 'loading' | 'ready' | 'unavailable';
}

export interface BoardGifMedia {
  previewUrl: string | null;
  renderUrl: string;
  width: number;
  height: number;
}

export interface ResolvedBoardGif extends BoardGif {
  media: BoardGifMedia;
  hydrationState: 'ready';
}

export interface BoardGifSelection {
  ownedItemId: string;
  giphyId: string;
}

export interface BoardPhoto {
  url: string;
  width: number;
  height: number;
  revision: string;
}

export interface PhotoFrameImageResult {
  ownedItemId: string;
  photo: BoardPhoto;
}

export interface GiphySearchPage {
  items: BoardGif[];
  offset: number;
  nextOffset: number | null;
}

export interface BoardData {
  items: BoardObject[];
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
