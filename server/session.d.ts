import 'express-session';

declare module 'express-session' {
  interface SessionData {
    oauthState?: string;
    oauthReturnTo?: '/dashboard' | '/inventory' | '/settings';
    discordUserId?: string;
    username?: string;
    globalName?: string | null;
    avatarHash?: string | null;
  }
}
