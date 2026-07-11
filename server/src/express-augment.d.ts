/**
 * Express Request の拡張 (#330 TS 移行で導入)
 * - req.user: authenticate middleware が設定
 * - req.memberRole: requireMember middleware が設定
 */
import type { AuthUser } from './types.mts';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      memberRole?: string;
    }
  }
}

export {};
