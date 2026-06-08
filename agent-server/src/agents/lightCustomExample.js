/**
 * Light tier 自作 backend 最小実装 skeleton (#292)
 *
 * このファイルは **docs 目的の sample**、agent-server 本体は use しません。
 * 自作 backend を持ち込む際の plug interface contract reference として利用:
 *
 *   1. `processLight({ ... })` を export
 *   2. 副作用: botApi.pushMessage で roomId に応答、return Promise<void>
 *   3. error: backend 内 catch + pushMessage('エラー: ...')、throw 推奨せず
 *
 * 使い方:
 *   1. このファイルを参考に `agents/lightCustom.js` を作成
 *   2. `agent-server/.env` で:
 *        AGENT_LIGHT_BACKEND=/abs/path/to/lightCustom.js
 *   3. agent-server 再起動
 *   4. `/light` で自作 backend が呼ばれる
 *
 * sample 動作: prompt の冒頭 100 字を echo するだけ。
 */
const botApi = require('../lib/botApi');
const logger = require('../lib/logger');

/**
 * @param {Object} args
 * @param {string} args.roomId        - Tealus room UUID (必須)
 * @param {string} args.prompt        - 完成済 user prompt (= room ID embed + reply_to hint 含む)
 * @param {string} args.workspacePath - room 専用 workspace の絶対 path
 * @param {string} [args.agentId]     - agent registration UUID (status 更新等で必要なら)
 * @param {string} [args.sessionId]   - session UUID (context 引継ぎが必要なら)
 * @param {Array}  [args.mcpServers]  - MCPServerStdio instance 配列 (V1 系のみ使用、自作は ignore 可)
 * @returns {Promise<void>}
 */
async function processLight({ roomId, prompt, workspacePath, agentId, sessionId, mcpServers }) {
  try {
    // 任意の status 通知 (= UI で「考え中...」 表示)
    await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});

    // sample: ここで任意の LLM 呼び出し or rule engine logic
    // 実 backend では openai-agents SDK / codex SDK / Ollama / vLLM 等を使う
    const echoText = `[custom backend echo] ${prompt.slice(0, 100)}`;

    await botApi.pushMessage(roomId, echoText);
    await botApi.pushStatus(roomId, 'idle').catch(() => {});
  } catch (err) {
    logger.error(`[LightCustomExample] error: ${err.message}`);
    // error 時も pushMessage で user に伝える (= throw しない)
    await botApi.pushMessage(roomId, `エラー: ${err.message}`).catch(() => {});
    await botApi.pushStatus(roomId, 'idle').catch(() => {});
  }
}

module.exports = { processLight };
