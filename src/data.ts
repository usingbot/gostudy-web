import { User, Reward } from './types';

export const mockUser: User = {
  id: 'discord-123456',
  username: 'StudyGod42',
  avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=StudyGod42&backgroundColor=5865F2',
  totalHours: 124,
  currentSessionMinutes: 45,
  minutesToNextReward: 60,
};

export const mockRewards: Reward[] = [
  {
    id: 'coffee',
    name: 'Coffee',
    iconName: 'Coffee',
    description: 'The fuel of champions.',
    earnedAt: '2023-10-26T14:00:00Z',
    quantity: 12,
  },
  {
    id: 'books',
    name: 'Books',
    iconName: 'BookOpen',
    description: 'Knowledge is power.',
    earnedAt: '2023-10-25T01:00:00Z',
    quantity: 4,
  },
  {
    id: 'moon',
    name: 'Moon',
    iconName: 'Moon',
    description: 'Studied past midnight.',
    earnedAt: '2023-10-24T16:00:00Z',
    quantity: 1,
  },
  {
    id: 'study-star',
    name: 'Study Star',
    iconName: 'Star',
    description: 'Shining bright.',
    earnedAt: '2023-10-22T09:00:00Z',
    quantity: 8,
  },
  {
    id: 'token',
    name: 'Verified Token',
    iconName: 'ShieldCheck',
    description: 'Verified hour token fallback.',
    earnedAt: '2023-10-20T11:00:00Z',
    quantity: 24,
  },
];
