/**
 * OrganonReloader — organon repo の polyseme entries を load + LLM prompt inject 用に整形
 *
 * Phase A (= 本 file、5/22 Day 6 (i) skeleton):
 *   - load + format のみ (= core path)
 *   - YAML parse は LLM 推論層に委ねる (= raw text inject、schema evolution に robust)
 *   - 10 unit test green (= __tests__/unit/organonReloader.test.js、isAvailable / loadPolysemeEntries
 *     / formatForPrompt / invalidate 全 method cover)
 *
 * ★ Phase B (= 5/30 Day 14 時点で **凍結**、整合性ある Phase B re-trigger 待ち):
 *
 *   1. agent-server は claude -p 経由で prompt 素通し pattern、systemPrompt 構築 layer なし
 *      → 本 reloader を agent-server で inject する選択肢 4 候補のうち、(D) Claude Code 側
 *      skill での参照が cleanest と Day 14 で評価、本 agent-server 経由は overengineering
 *      risk。utilization 層は tealus-organon repo の Claude Code skill (= 議事録 skill /
 *      DB-grounded skill 等の family) で対応する方向。
 *
 *   2. 構築層 = polyseme.sql_mapping field 蓄積 cycle が動いていない状態 (Day 14 時点
 *      polyseme = 5 件、sql_mapping field 0 件、5/16 ground truth「納品/流れ/店長確認」
 *      entry 不在)。Phase B integrate を本 agent-server で行うべき trigger は、(a)
 *      DB-grounded skill の operational evidence 蓄積後、(b) 構築層 polyseme.sql_mapping
 *      が一定量に達した時点、(c) agent-server 経由 inject の clear need が surface した時、
 *      のいずれか。
 *
 *   3. それまで本 file = Phase A skeleton + test green の凍結 reference として保持
 *      (= deprecate しない、削除しない、本日時点で動作 verified)。
 *
 * 関連:
 *   - Issue #283 (= SQL bridge thesis、5/21 (d) 起票) Phase A 着手 (= 5/22 Day 6 (i) PoC
 *     evidence 5 dimension 達成後の dep 解除 trigger)
 *   - Day 14 (= 5/30) organon-side AI 班連絡 msg `b1619286` (= DB-grounded skill 提案)
 *   - Day 14 議事録 skill 議論 reset (= 利用層 skill = Claude Code 側で済む構造、本体班
 *     agent-server 実装は overengineering リスク認識)
 *
 * organon 側 schema (= 5/22 Day 6 時点、v0.5.x):
 *   - kind: polyseme (= 業務語 ↔ DB column 値 mapping、Day 6 (g) で 4 件 grounded)
 *   - sql_mapping field の 2 type 確定 (= simple + fuzzy_match、composite 撤回 Day 6 (g))
 *   - ★ ただし Day 14 時点で sql_mapping field を持つ entry は 0 件、schema candidate 段階
 *
 * 注意: organon repo は **別 git repo** (= `C:/app/tealus-organon/`)、本体 repo 外。
 * ORGANON_REPO_PATH env で上書き可能、default は ../../tealus-organon (= relative)。
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DEFAULT_ORGANON_PATH = process.env.ORGANON_REPO_PATH
  || path.resolve(__dirname, '../../../../tealus-organon');

class OrganonReloader {
  constructor({ repoPath = DEFAULT_ORGANON_PATH } = {}) {
    this.repoPath = repoPath;
    this.cached = null;
  }

  /**
   * organon repo の存在確認 (= mount check)
   * @returns {boolean}
   */
  isAvailable() {
    return fs.existsSync(this.repoPath)
      && fs.existsSync(path.join(this.repoPath, 'entries'));
  }

  /**
   * polyseme entries を raw YAML として load
   * @returns {Array<{filename, term, content}>}
   */
  loadPolysemeEntries() {
    const dir = path.join(this.repoPath, 'entries', 'polyseme');
    if (!fs.existsSync(dir)) {
      logger.warn(`[organonReloader] polyseme dir not found: ${dir}`);
      this.cached = [];
      return [];
    }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));
    const entries = files.map(filename => ({
      filename,
      term: filename.replace(/\.yaml$/, ''),
      content: fs.readFileSync(path.join(dir, filename), 'utf8'),
    }));
    this.cached = entries;
    logger.info(`[organonReloader] polyseme loaded: ${entries.length} entries from ${dir}`);
    return entries;
  }

  /**
   * polyseme entries を prompt-injectable text block に整形
   *
   * LLM (= gpt-4o / gpt-5) は YAML を context で parse 可能、本 skeleton では
   * raw YAML を code block で inject、schema evolution (= sql_mapping field 追加等)
   * に robust。
   *
   * @param {Array} [entries] - load 済 entries (= 省略時は cached or 新規 load)
   * @returns {string} - prompt block (= 空 entries 時は空文字)
   */
  formatForPrompt(entries) {
    const list = entries || this.cached || this.loadPolysemeEntries();
    if (!list.length) return '';
    const blocks = list.map(e =>
      `### ${e.term}\n\`\`\`yaml\n${e.content.trim()}\n\`\`\``
    );
    return [
      '## 業務語彙 — organon polyseme (= 業務語 ↔ DB column 値 mapping)',
      '',
      '以下は組織内の polyseme (= 多義語) entries。SQL 生成時に business meaning と DB 値の mapping として参照すること。',
      '',
      ...blocks,
    ].join('\n');
  }

  /**
   * cache invalidate (= ad-hoc reload trigger、Phase B で 3 cycle と統合)
   */
  invalidate() {
    this.cached = null;
    logger.info('[organonReloader] cache invalidated');
  }
}

module.exports = { OrganonReloader, DEFAULT_ORGANON_PATH };
