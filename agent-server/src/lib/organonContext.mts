/**
 * Organon Context — organon repo の polyseme.sql_mapping を agent prompt に inject
 *
 * 課題: Deep / Light agent が DB 検索 query を受けた時、organon の業務語彙 ↔ DB column 値
 * mapping (= polyseme.sql_mapping、Day 15 で 4 件 grounded) を参照せず、毎回 ad-hoc に SQL
 * 生成して間違える (= 5/16 4 round 訂正 trace pattern が再発火 risk)。
 *
 * 解: 全 agent (= Light v1 / v2 / Deep / Deep Codex) の prompt に本 module の
 * loadOrganonPolysemeForPrompt() で polyseme + sql_mapping を inline text block として渡す。
 *
 * ★ 配線の実態 (#347、実測): 注入は 2 経路で全 agent に届く。
 *   - Light v1 / v2: agent module 内で自己配線 (light.mts / lightV2.mts が直接呼ぶ)。
 *   - Deep / Deep Codex: dispatcher.mts の buildDeepPrompt() が呼び、組んだ prompt を
 *     processDeep / processDeepCodex に渡す (= agent module 内には呼び出しが無い)。
 *   deepCodex.mts 単体を grep すると呼び出しが見えないが、注入は一段上の dispatcher で
 *   起きている。「Deep は未注入」と読み違えないこと。
 *
 * env:
 *   - ORGANON_REPO_PATH: organon repo の root path (= default C:/app/tealus-organon 想定、
 *     organonReloader.js と共有)
 *   - ORGANON_INJECT: 'true' で inject 有効化 (= opt-in、#304)。未設定 / 'true' 以外は無効 (default OFF)。
 *     organon は Tealus 本体と分離可能なサブシステムなので、使う deployment だけが明示的に opt-in する。
 *     旧 INJECT_ORGANON_POLYSEME (default ON の opt-out) は廃止、fallback も無し。
 *
 * 関連:
 *   - #276 (= Codex Deep agent) follow-up: 全 agent 共通の organon context inject
 *   - organonReloader.js (= agent-server/src/lib/、5/22 #283 Phase A skeleton、Phase B 凍結)
 *   - tealus-organon の db-organon-build skill (= 5/31 Day 15 構築層 cycle 第 1 例)
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.mts';

export const DEFAULT_ORGANON_PATH = process.env.ORGANON_REPO_PATH
  || path.resolve(import.meta.dirname, '../../../../tealus-organon');

/**
 * organon inject が opt-in されているか (= ORGANON_INJECT==='true'、default OFF)
 */
export function isInjectEnabled(): boolean {
  return process.env.ORGANON_INJECT === 'true';
}

/**
 * organon repo が存在するか check (= polyseme dir まで)
 */
export function isAvailable(organonPath: string = DEFAULT_ORGANON_PATH): boolean {
  return fs.existsSync(organonPath)
    && fs.existsSync(path.join(organonPath, 'entries', 'polyseme'));
}

export interface SqlMappingEntry {
  term: string;
  content: string;
}

/**
 * #349 Tier 1: polyseme yaml から `sql_mapping:` ブロックだけを抽出する (純関数)。
 *
 * organonContext は従来 polyseme yaml を丸ごと prompt に注入していたが、DB 検索 grounding に
 * 必要な事実 (table/field/式/filter/混同注意) は sql_mapping ブロックに揃っており、その外の散文
 * (概要/多義/hazard/provenance/links) は grounding には marginal と検証済み (inspection + 実機
 * dogfood: 買取を V_商品_入出庫/区分='入庫'/SUM(入庫数量*単価) で正答)。よって sql_mapping
 * ブロックのみに絞り、毎プロンプトの生 yaml bloat (7 entry で ~872 行) を削る。
 *
 * 抽出規則: `sql_mapping:` 行から、次の top-level key (= 字下げ無し `key:` 行) の直前まで。
 * sql_mapping が最後の key なら EOF まで。末尾の空行は trim。sql_mapping 不在なら空文字。
 */
export function extractSqlMappingBlock(yaml: string): string {
  const lines = yaml.split(/\r?\n/);
  const out: string[] = [];
  let capturing = false;
  for (const line of lines) {
    if (!capturing) {
      if (/^sql_mapping\s*:/.test(line)) {
        capturing = true;
        out.push(line);
      }
      continue;
    }
    // 次の top-level key (字下げ無し・非コメントの `key:`) に到達したら終了。
    // ブロックスカラ(|)の中身や nested key は字下げされているので巻き込まない。
    if (/^[^\s#]/.test(line) && /^[^\s#][^:]*:/.test(line)) break;
    out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

/**
 * polyseme yaml 全件 read、sql_mapping field 持つ entries だけ抽出
 *
 * @param organonPath - organon repo root path (= test 用、default は env / DEFAULT)
 * @returns sql_mapping 持つ entries (= term + raw yaml content)
 */
export function loadSqlMappingEntries(organonPath: string = DEFAULT_ORGANON_PATH): SqlMappingEntry[] {
  if (!isAvailable(organonPath)) return [];
  const polysemeDir = path.join(organonPath, 'entries', 'polyseme');
  const files = fs.readdirSync(polysemeDir).filter((f) => f.endsWith('.yaml'));
  const entries: SqlMappingEntry[] = [];
  for (const file of files) {
    const fullPath = path.join(polysemeDir, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('sql_mapping:')) {
        // #349 Tier 1: 生 yaml 全文でなく sql_mapping ブロックのみ注入 (散文は grounding に marginal)
        const block = extractSqlMappingBlock(content);
        if (block) {
          entries.push({
            term: file.replace(/\.yaml$/, ''),
            content: block,
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[organonContext] read failed: ${fullPath}: ${message}`);
    }
  }
  return entries;
}

/**
 * loadSqlMappingEntries() 結果を prompt 用 text block に整形
 *
 * - ORGANON_INJECT!=='true' (= 未設定含む default) → 空文字 (opt-in OFF)
 * - organon 不在 → 空文字 (silent skip)
 * - sql_mapping 持つ entries 0 件 → 空文字
 * - それ以外 → "## 業務 DB 検索時の参考..." block を返す
 *
 * @returns prompt 末尾に concat する text (= 空文字 or 整形済 block)
 */
export function loadOrganonPolysemeForPrompt(options: { organonPath?: string } = {}): string {
  if (!isInjectEnabled()) return '';

  const organonPath = options.organonPath || DEFAULT_ORGANON_PATH;
  const entries = loadSqlMappingEntries(organonPath);
  if (entries.length === 0) return '';

  const blocks = entries.map((e) => `### ${e.term}\n\`\`\`yaml\n${e.content}\n\`\`\``);
  return [
    '',
    '## 業務 DB 検索時の参考 (= organon polyseme + sql_mapping)',
    '',
    '以下の業務語彙 ↔ alias / mapping を参照してください。複数 use case で活用:',
    '- **DB 検索 / SQL 生成**: 業務語 (例: 「納品」「売上」) を SQL の column 値 / WHERE 条件に展開する時、organon entry の sql_mapping field を ground truth として使う',
    '- **議事録 / 業務記録生成**: 人物名揺らぎ訂正 (= alias 適用、例: 「マサ→山崎」「ソートメ→五月女」) + 業務語 mapping 反映',
    '- **alias 訂正方針**: 既知 entry に alias 確定済なら正規名に訂正、未登録 / 確信度低い推測は [要確認] marker で残し、議事録末尾に 「## organon 記法 注意事項」 section で reasoning を集約',
    '',
    'entries:',
    '',
    ...blocks,
    '',
  ].join('\n');
}

/**
 * 起動時に organon inject の ON/OFF を 1 行ログ (= silent regression 防止、検証可能化)
 *
 * default OFF への flip (#304) で、本番が ORGANON_INJECT を明示し忘れると inject が黙って止まる。
 * 起動ログで状態 (+ 有効時は entries 数) を残し、ON/OFF を log で binary 確認できるようにする。
 *
 * #347 ①: ORGANON_INJECT=true なのに organon 不在 / entries 0 件は「ON と宣言したのに
 * 実際は何も注入されない」silent degrade。migration-check と同型で loud WARN を出す
 * (organon は任意サブシステムなので FATAL でなく WARN、稼働は止めない)。
 */
export function logOrganonInjectState(options: { organonPath?: string } = {}): void {
  if (!isInjectEnabled()) {
    logger.info('[organonContext] organon inject: OFF (set ORGANON_INJECT=true to enable)');
    return;
  }
  const organonPath = options.organonPath || DEFAULT_ORGANON_PATH;
  if (!isAvailable(organonPath)) {
    logger.warn(
      `[organonContext] organon inject: ON but organon が見つかりません (path=${organonPath}) — `
      + 'polyseme grounding は無効のまま黙って止まっています。'
      + 'organon repo を配置するか ORGANON_INJECT=false を設定してください。',
    );
    return;
  }
  const entries = loadSqlMappingEntries(organonPath);
  if (entries.length === 0) {
    logger.warn(
      `[organonContext] organon inject: ON but sql_mapping entries=0 (path=${organonPath}) — `
      + '注入する内容が無く実質空です。organon の entries/polyseme を確認してください。',
    );
    return;
  }
  logger.info(`[organonContext] organon inject: ON (entries=${entries.length}, path=${organonPath})`);
}
