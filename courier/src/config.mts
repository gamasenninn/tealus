/**
 * ブリッジの登録 (docs/12 §5)。置き場は配達役の機械の ~/.tealus/courier/bridges.json (repo・DB の外)。
 * ★ 形の違う行は使わない (班の名前はファイル名になる・届け先の名前はコマンドの引数になる)
 * ★ 同じ班が 2 回あれば全体を読み込まない (1 つの班に配る人は 1 人)
 * ★ 段階 1 の届け先は herdr (この機械) だけ。SSH 越し・PaneDeck のペイン・codex は段階 2 以降
 */
import fs from 'node:fs';
import path from 'node:path';
import { isValidProject } from './cursor.mts';

export interface BridgeConfig { project: string; adapter: 'herdr'; agent: string }

const AGENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ADAPTERS = new Set(['herdr']);

export type LoadResult =
  | { ok: true; bridges: BridgeConfig[]; skipped: string[] }
  | { ok: false; reason: string };

export function loadBridges(dir: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'bridges.json'), 'utf8'));
  } catch (err) {
    return { ok: false, reason: `bridges.json を読めません (${(err as NodeJS.ErrnoException).code ?? 'JSON の形'})` };
  }
  if (!Array.isArray(raw)) return { ok: false, reason: 'bridges.json は配列で書いてください' };
  const bridges: BridgeConfig[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const [i, v] of raw.entries()) {
    const o = (v ?? {}) as Record<string, unknown>;
    const project = typeof o.project === 'string' ? o.project : '';
    if (seen.has(project)) return { ok: false, reason: `同じ班が 2 回あります: ${project} (1 つの班に配る人は 1 人)` };
    seen.add(project);
    if (o.enabled === false) continue;
    if (!isValidProject(project)) { skipped.push(`${i} 行目: 班の名前の形が違います`); continue; }
    if (typeof o.adapter !== 'string' || !ADAPTERS.has(o.adapter)) { skipped.push(`${i} 行目 (${project}): 届け先の種類が使えません`); continue; }
    if (typeof o.agent !== 'string' || !AGENT_RE.test(o.agent)) { skipped.push(`${i} 行目 (${project}): 届け先の名前の形が違います`); continue; }
    bridges.push({ project, adapter: 'herdr', agent: o.agent });
  }
  return { ok: true, bridges, skipped };
}
