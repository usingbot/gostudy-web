export interface User {
  id: string;
  username: string;
  avatarUrl: string;
  totalHours: number;
  currentSessionMinutes: number;
  minutesToNextReward: number;
}

export interface Reward {
  id: string;
  name: string;
  iconName: string;
  description: string;
  earnedAt: string;
  quantity: number;
}
