/**
 * Organon Context — organon repo の polyseme.sql_mapping を agent prompt に inject
 *
 * 課題: Deep / Light agent が DB 検索 query を受けた時、organon の業務語彙 ↔ DB column 値
 * mapping (= polyseme.sql_mapping、Day 15 で 4 件 grounded) を参照せず、毎回 ad-hoc に SQL
 * 生成して間違える (= 5/16 4 round 訂正 trace pattern が再発火 risk)。
 *
 * 解: 全 agent (= Light v1 / v2 / Deep / Deep Codex) の system prompt build に本 module の
 * loadOrganonPolysemeForPrompt() を呼んで、polyseme + sql_mapping を inline text block で渡す。
 *
 * env:
 *   - ORGANON_REPO_PATH: organon repo の root path (= default C:/app/tealus-organon 想定、
 *     organonReloader.js と共有)
 *   - INJECT_ORGANON_POLYSEME: 'true' (default) | 'false' (= toggle、test / 旧挙動用)
 *
 * 関連:
 *   - #276 (= Codex Deep agent) follow-up: 全 agent 共通の organon context inject
 *   - organonReloader.js (= agent-server/src/lib/、5/22 #283 Phase A skeleton、Phase B 凍結)
 *   - tealus-organon の db-organon-build skill (= 5/31 Day 15 構築層 cycle 第 1 例)
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DEFAULT_ORGANON_PATH = process.env.ORGANON_REPO_PATH
  || path.resolve(__dirname, '../../../../tealus-organon');

/**
 * organon repo が存在するか check (= polyseme dir まで)
 */
function isAvailable(organonPath = DEFAULT_ORGANON_PATH) {
  return fs.existsSync(organonPath)
    && fs.existsSync(path.join(organonPath, 'entries', 'polyseme'));
}

/**
 * polyseme yaml 全件 read、sql_mapping field 持つ entries だけ抽出
 *
 * @param {string} [organonPath] - organon repo root path (= test 用、default は env / DEFAULT)
 * @returns {Array<{term, content}>} sql_mapping 持つ entries (= term + raw yaml content)
 */
function loadSqlMappingEntries(organonPath = DEFAULT_ORGANON_PATH) {
  if (!isAvailable(organonPath)) return [];
  const polysemeDir = path.join(organonPath, 'entries', 'polyseme');
  const files = fs.readdirSync(polysemeDir).filter((f) => f.endsWith('.yaml'));
  const entries = [];
  for (const file of files) {
    const fullPath = path.join(polysemeDir, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('sql_mapping:')) {
        entries.push({
          term: file.replace(/\.yaml$/, ''),
          content: content.trim(),
        });
      }
    } catch (err) {
      logger.warn(`[organonContext] read failed: ${fullPath}: ${err.message}`);
    }
  }
  return entries;
}

/**
 * loadSqlMappingEntries() 結果を prompt 用 text block に整形
 *
 * - INJECT_ORGANON_POLYSEME=false → 空文字
 * - organon 不在 → 空文字 (silent skip)
 * - sql_mapping 持つ entries 0 件 → 空文字
 * - それ以外 → "## 業務 DB 検索時の参考..." block を返す
 *
 * @param {Object} [options]
 * @param {string} [options.organonPath] - test 用 override
 * @returns {string} prompt 末尾に concat する text (= 空文字 or 整形済 block)
 */
function loadOrganonPolysemeForPrompt(options = {}) {
  const inject = (process.env.INJECT_ORGANON_POLYSEME || 'true') !== 'false';
  if (!inject) return '';

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

module.exports = {
  loadOrganonPolysemeForPrompt,
  loadSqlMappingEntries,
  isAvailable,
  DEFAULT_ORGANON_PATH,
};
