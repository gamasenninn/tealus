/**
 * #331 organon dock watcher — organon.ttl (RDF 公開契約) の到着を watch して pull を発火する。
 *
 * cadence = 「crystallize 連動 signal」の decoupled 実装。organon 側は日次 crystallize の
 * Step 5 で `tools/organon.ttl` を生成+commit するだけ (emit の追加作業・token なし)。
 * organon repo と tealus 本体は同一ホスト/同一 FS の sibling repo なので、tealus は
 * commit 後の working-tree ファイルを直接見られる = 配送レイヤー不要・commit 即発火。
 *
 * 設計:
 *   - 検知は「内容 hash」ベース。organon_to_rdf.py は決定論 serialize (2回一致実測) なので、
 *     実変更が無ければ hash 不変 = no-op commit で無駄 reload しない。
 *   - 発火時は syncFromOrganon (辞書テーブルへ upsert) → refreshVocabFromTable
 *     (in-memory overlay 更新) を **同一プロセス内で直接呼ぶ** (admin token / HTTP 不要)。
 *   - sync 失敗時は lastHash を進めず、次 tick で自然に retry。
 *   - ORGANON_TTL_PATH 未設定なら watcher 無効 (base は organon 非依存で常時稼働)。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { logger } from '../utils/logger.mts';
import { syncFromOrganon } from '../../scripts/sync_organon_dict.mts';
import { refreshVocabFromTable } from './transcriptionConfig.mts';

const DEFAULT_INTERVAL_MS = 300_000; // 5 分 (organon.ttl は日次更新、poll は疎で十分)

let _lastHash: string | null = null;
let _timer: NodeJS.Timeout | null = null;

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * TTL の内容変化を検知し、変わっていれば sync + overlay reload を発火する。
 * @returns changed = 発火したか / hash = 現在の内容 hash (ファイル無しは null)
 */
export async function checkAndSync(ttlPath: string): Promise<{ changed: boolean; hash: string | null }> {
  if (!fs.existsSync(ttlPath)) return { changed: false, hash: null };

  const hash = hashContent(fs.readFileSync(ttlPath, 'utf8'));
  if (hash === _lastHash) return { changed: false, hash }; // 内容不変 → no-op

  try {
    const { terms, aliases } = await syncFromOrganon(ttlPath);
    await refreshVocabFromTable();
    _lastHash = hash; // 成功時のみ hash を進める
    logger.info(`[organon-dock] pulled from ${ttlPath}: ${terms} terms / ${aliases} aliases (source=organon), overlay reloaded`);
    return { changed: true, hash };
  } catch (err) {
    // lastHash を進めない = 次 tick で retry
    logger.warn(`[organon-dock] pull failed (will retry): ${err instanceof Error ? err.message : String(err)}`);
    return { changed: false, hash };
  }
}

/**
 * Watcher を起動する。ORGANON_TTL_PATH を watch し、起動時に 1 回 + 以降 poll で発火。
 * path 未設定なら無効 (dock は optional)。
 */
export function start(): void {
  const ttlPath = process.env.ORGANON_TTL_PATH;
  if (!ttlPath) {
    logger.info('[organon-dock] watcher disabled (ORGANON_TTL_PATH 未設定 = base のみで稼働)');
    return;
  }
  const interval = parseInt(process.env.ORGANON_WATCH_INTERVAL_MS || String(DEFAULT_INTERVAL_MS), 10);
  logger.info(`[organon-dock] watcher started: ${ttlPath} (poll ${interval}ms)`);
  void checkAndSync(ttlPath).catch((err) => logger.warn(`[organon-dock] initial pull error: ${err instanceof Error ? err.message : String(err)}`));
  _timer = setInterval(() => {
    void checkAndSync(ttlPath).catch((err) => logger.warn(`[organon-dock] poll error: ${err instanceof Error ? err.message : String(err)}`));
  }, interval);
  if (_timer.unref) _timer.unref(); // watcher が event loop を掴んで process を延命しない
}

/** Watcher を停止し内部状態をリセットする (テスト teardown / shutdown 用)。 */
export function stop(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _lastHash = null;
}
