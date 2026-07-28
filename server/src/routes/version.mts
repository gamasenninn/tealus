import fs from 'fs';
import path from 'path';
import express from 'express';
import { logger } from '../utils/logger.mts';
import { NO_STORE } from '../utils/staticCache.mts';

/**
 * #356 GET /api/version — いま配っているクライアントのビルド ID。
 *
 * クライアントは自分に焼き込まれた `__BUILD_ID__` とこれを突き合わせ、食い違えば
 * 「更新あり」と判断する。Service Worker の precache が古い画面を出していても、
 * `/api/*` は precache 対象外かつ navigateFallbackDenylist にも入っているため
 * この fetch だけは必ずネットワークに届く。iOS の SW 更新チェックに依存しないための要。
 *
 * 認証不要 — ログイン画面でも陳腐化を検知できる必要がある。返すのはビルド識別子のみ。
 */
export const router = express.Router();

const versionFilePath = path.join(import.meta.dirname, '../../../client/dist/version.json');

router.get('/', (req, res) => {
  // 起動時に読んで固定すると、サーバ稼働中にクライアントを再ビルドしたとき古い ID を
  // 返し続け「いつまでも更新あり」になる。毎回読む (数十バイトなので実害なし)。
  let buildId: string | null = null;
  try {
    const raw = fs.readFileSync(versionFilePath, 'utf8');
    const parsed = JSON.parse(raw) as { build_id?: unknown };
    if (typeof parsed.build_id === 'string') buildId = parsed.build_id;
  } catch {
    // 未ビルド (dev) や読み取り失敗は「不明」として扱わせる。ここで 500 にすると
    // client 側が更新検知のたびにエラーを踏むので、null を返して黙らせる。
    logger.debug('version: client build id unavailable');
  }

  res.setHeader('Cache-Control', NO_STORE);
  res.json({ build_id: buildId });
});
