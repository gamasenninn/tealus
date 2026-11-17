import express from 'express';
import { authenticate } from '../middleware/auth.mts';
import { isGuest } from '../utils/permissions.mts';
import { loadAppPassKey } from '../utils/appPass.mts';
import { signAppLogin, parseLoginTargets, loginCallbackUrl, LOGIN_STATE_RE } from '../utils/appLogin.mts';
import { logger } from '../utils/logger.mts';

export const router = express.Router();
router.use(authenticate);

const LOGIN_UNAVAILABLE = 'このサイトにはログインの札を出せません';

/**
 * POST /api/sso/app-login  (body: { aud, state })
 * ブラウザから「Tealus でログイン」(docs/11 §5.5、2026-11-17)。相手のサイトの決まった戻り先に、
 * ログイン専用の札 (typ:"login"・state つき・60 秒) を付けた URL を返す。
 * ★ 戻り先は引数で受けない (APP_LOGIN_TARGETS の許可表だけ)。札そのものは記録に書かない
 */
router.post('/app-login', (req, res) => {
  const { aud, state } = (req.body ?? {}) as { aud?: unknown; state?: unknown };
  if (typeof state !== 'string' || !LOGIN_STATE_RE.test(state)) {
    return res.status(400).json({ error: 'state は 32 桁の 16 進 (小文字) で指定してください' });
  }
  const audLabel = typeof aud === 'string' ? aud.slice(0, 100) : '-';
  const refuse = (why: string) => {
    logger.info(`[app-login] 出さない: aud=${audLabel} user=${req.user!.id} — ${why}`);
    return res.status(404).json({ error: LOGIN_UNAVAILABLE });
  };
  // ★ 通す範囲はホームのタブの通行証と同じ (docs/11 §5.4)。止めた人は authenticate で弾かれている
  if (isGuest(req.user)) return refuse('ゲスト');
  if (req.user!.is_bot) return refuse('機械のアカウント');
  if (typeof aud !== 'string') return refuse('aud が無い');

  const cbPath = parseLoginTargets(process.env.APP_LOGIN_TARGETS).get(aud);
  if (!cbPath) return refuse('許可表に無い aud');
  const key = loadAppPassKey(new URL(aud).hostname.toLowerCase());
  if (!key) return refuse('鍵が無い');

  const token = signAppLogin(key, {
    aud, sub: req.user!.id, name: req.user!.display_name, state,
  }, Math.floor(Date.now() / 1000));
  logger.info(`[app-login] 出した: aud=${aud} user=${req.user!.id}`);
  res.json({ url: loginCallbackUrl(aud, cbPath, token) });
});

