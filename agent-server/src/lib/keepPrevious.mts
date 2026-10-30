import fs from 'node:fs';
import { logger } from './logger.mts';

/**
 * 設定ファイルを書き換える (または消す) 前に、今の中身を `<file>.prev` に 1 つだけ残す (2026-10-30 小野さん判断 1)。
 *
 * ★ AI の設定 (部屋のプロンプト・CLAUDE.md・道具、全体の settings.json・system_prompt.md) は保存が上書きで、
 *   空で保存・誤った保存をすると戻せなかった。毎日のバックアップは 1 日 1 回なので、その日のうちの誤りはこちらで戻す。
 * ★ 同じ中身を書くときは残さない (保存を 2 回押しても、前の版が今の版で潰れないように)。
 * ★ 残せなくても保存は止めない (記録だけ)。
 */
export function keepPrevious(filePath: string, nextContent: string | null): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const current = fs.readFileSync(filePath, 'utf8');
    if (nextContent !== null && current === nextContent) return;
    fs.writeFileSync(`${filePath}.prev`, current);
  } catch (err) {
    logger.warn(`[keep-previous] 前の版を残せませんでした: ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
