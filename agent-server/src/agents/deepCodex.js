/**
 * Deep Codex Agent — `codex exec` spawn (#276)
 *
 * 現 Deep agent (= `claude -p` spawn、deep.js) の Codex CLI 版 mirror。
 * env DEEP_AGENT_PROVIDER=codex で dispatcher が本 file の processDeepCodex を呼ぶ。
 *
 * 設計判断:
 * - CLI spawn pattern: codex CLI も Claude `-p` 同型の stdin/stdout pipe (= codex exec - --json)
 * - MCP config: ~/.codex/config.toml 直接編集を避け、CODEX_HOME を workspace 配下に切替で room-specific 完全制御
 * - auth: subscription path (= ~/.codex/auth.json) を copy で継承、API key fallback は env で明示 opt-in
 * - approval / sandbox: --dangerously-bypass-approvals-and-sandbox + --sandbox danger-full-access
 *
 * 関連: Issue #276 (= [spike] codex exec / app server の deep capability 検証)
 *       Light v2 (#258、lightV2.js) で確立済の Codex SDK auth pattern を CLI mode で再現
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const logger = require('../lib/logger');
const botApi = require('../lib/botApi');
const deepRegistry = require('./deepRegistry');
const config = require('../config');
const { buildLightV2McpConfig } = require('./lightV2');
const { detectCodexAuthError, buildAuthFailUserMessage } = require('../lib/codexAuthError');

function getDefaultCodexHome() {
  return path.join(os.homedir(), '.codex');
}

/**
 * TOML 文字列 escape (= basic string、" 内で使う想定の subset)
 * backslash → \\、double quote → \"
 */
function tomlEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * mcp_servers object を TOML format に serialize
 *
 * 入力 = deep.js の createDeepMcpConfig 同 form:
 *   {
 *     tealus: { command: 'npx', args: [...], env: { TEALUS_API_URL: '...' } },
 *   }
 *
 * 出力 (= codex CLI が認識する [mcp_servers.X] section form):
 *   [mcp_servers.tealus]
 *   command = "npx"
 *   args = ["-y", "github:..."]
 *
 *   [mcp_servers.tealus.env]
 *   TEALUS_API_URL = "..."
 */
function serializeMcpServersToToml(mcp_servers) {
  const lines = [];
  for (const [name, def] of Object.entries(mcp_servers)) {
    lines.push(`[mcp_servers.${name}]`);
    if (def.command) {
      lines.push(`command = "${tomlEscape(def.command)}"`);
    }
    if (Array.isArray(def.args)) {
      const argsToml = def.args.map((a) => `"${tomlEscape(a)}"`).join(', ');
      lines.push(`args = [${argsToml}]`);
    }
    lines.push('');
    if (def.env && typeof def.env === 'object' && Object.keys(def.env).length > 0) {
      lines.push(`[mcp_servers.${name}.env]`);
      for (const [k, v] of Object.entries(def.env)) {
        lines.push(`${k} = "${tomlEscape(v)}"`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

/**
 * workspace 配下に .codex_home/ を準備:
 * - ~/.codex/auth.json を copy (= subscription auth path 継承)
 * - config.toml 動的生成 (= mcp_servers 定義)
 *
 * spawn 時 env CODEX_HOME=<返り値> で切替する。
 *
 * @param {string} workspacePath - room workspace の絶対 path
 * @param {Object} mcp_servers - MCP server 定義 object
 * @param {Object} [options]
 * @param {string} [options.codexHomeSrc] - auth.json の copy 元 dir (= default ~/.codex)、test で fake home 用
 * @returns {string} codexHomePath - 設定済 .codex_home の絶対 path
 */
function prepareCodexHome(workspacePath, mcp_servers, options = {}) {
  const codexHomePath = path.join(workspacePath, '.codex_home');
  fs.mkdirSync(codexHomePath, { recursive: true });

  // auth.json copy (subscription auth path 継承)
  const codexHomeSrc = options.codexHomeSrc || getDefaultCodexHome();
  const srcAuthPath = path.join(codexHomeSrc, 'auth.json');
  const destAuthPath = path.join(codexHomePath, 'auth.json');
  if (fs.existsSync(srcAuthPath)) {
    fs.copyFileSync(srcAuthPath, destAuthPath);
    logger.debug(`[deepCodex] auth.json copied: ${srcAuthPath} -> ${destAuthPath}`);
  } else {
    logger.warn(`[deepCodex] ~/.codex/auth.json not found, subscription auth will fail. Run \`codex login\` first.`);
  }

  // config.toml 動的生成
  const tomlContent = serializeMcpServersToToml(mcp_servers || {});
  const configTomlPath = path.join(codexHomePath, 'config.toml');
  fs.writeFileSync(configTomlPath, tomlContent);
  logger.debug(`[deepCodex] config.toml written: ${configTomlPath} (${Object.keys(mcp_servers || {}).length} mcp_servers)`);

  return codexHomePath;
}

/**
 * #307: codex が rotation した auth.json を source (= ~/.codex) に書き戻す。
 *
 * codex は CODEX_HOME(=workspace/.codex_home) 配下の auth.json に refresh 後の新トークンを
 * 書き戻すが、prepareCodexHome は起動毎に source からコピー上書きするため rotation 結果が
 * 失われ、使用済み refresh token を引き戻して refresh_token_reused で失敗する。これを防ぐため
 * exec 完了後に workspace 側 auth.json を source へ書き戻す。
 *
 * 安全策:
 * - workspace 側が無い → 何もしない
 * - JSON として壊れている → 書き戻さない (cancel/kill 時の partial write 保護)
 * - source と内容一致 → no-op (rotation していない)
 * - 並列 Deep 実行中の clobber 回避は呼び出し側の sole-running guard に委ねる
 *
 * @returns {boolean} 書き戻したら true
 */
function writeBackCodexAuth(codexHomePath, codexHomeSrcDir) {
  try {
    const wsAuth = path.join(codexHomePath, 'auth.json');
    if (!fs.existsSync(wsAuth)) return false;
    const wsContent = fs.readFileSync(wsAuth, 'utf8');
    try {
      JSON.parse(wsContent);
    } catch {
      logger.warn(`[deepCodex] auth.json writeback skipped: workspace auth.json is not valid JSON (partial write?)`);
      return false;
    }
    const srcAuth = path.join(codexHomeSrcDir, 'auth.json');
    const srcContent = fs.existsSync(srcAuth) ? fs.readFileSync(srcAuth, 'utf8') : null;
    if (wsContent === srcContent) return false;
    fs.writeFileSync(srcAuth, wsContent);
    logger.info(`[deepCodex] auth.json rotated → wrote back to ${srcAuth}`);
    return true;
  } catch (err) {
    logger.warn(`[deepCodex] auth.json writeback failed: ${err.message}`);
    return false;
  }
}

/**
 * codex exec の spawn args を構築 (= claude -p - 同型の Codex 版)
 *
 * @param {Object} params
 * @param {string} params.workspacePath - working directory (= -C)
 * @param {string} params.model - codex モデル (= -m)
 * @returns {string[]} spawn args list
 */
function buildCodexExecArgs({ workspacePath, model }) {
  return [
    'exec', '-',                                  // stdin から prompt (= claude -p - 同型)
    '--json',                                     // JSONL event stream
    '--sandbox', 'danger-full-access',            // Light v2 同型、network access 含む
    '--dangerously-bypass-approvals-and-sandbox', // approval UI なし
    '--skip-git-repo-check',                      // git repo 制約 skip
    '-C', workspacePath,
    '-m', model,
  ];
}

/**
 * codex exec spawn 時の env を構築
 *
 * - useSubscription=true: OPENAI_API_KEY を env から除外 (= ~/.codex/auth.json で subscription auth)
 * - useSubscription=false + openaiApiKey set: OPENAI_API_KEY を env で渡す (= 従量課金)
 * - useSubscription=false + openaiApiKey unset: env からの伝播もなし (= codex 側で auth fail 期待)
 *
 * @param {Object} params
 * @param {string} params.codexHomePath - CODEX_HOME (= 動的 config dir)
 * @param {string} [params.openaiApiKey] - OPENAI_API_KEY (api-key mode 用)
 * @param {boolean} params.useSubscription - subscription mode flag
 * @param {Object} [params.baseEnv] - base env (= default process.env)
 * @returns {Object} env object for spawn
 */
function buildCodexExecEnv({ codexHomePath, openaiApiKey, useSubscription, baseEnv }) {
  const env = { ...(baseEnv || process.env), CODEX_HOME: codexHomePath };
  if (useSubscription) {
    delete env.OPENAI_API_KEY;
  } else if (openaiApiKey) {
    env.OPENAI_API_KEY = openaiApiKey;
  }
  return env;
}

/**
 * JSONL line buffer: stdout chunk を行単位に切って parse する
 *
 * codex exec --json は 1 line = 1 JSON event の JSONL を stdout に流す。
 * Node stream の chunk は line 境界で来ないため、次 chunk まで buffer 必要。
 *
 * - append(chunk): chunk を保持、完成行を parse 結果として返す (invalid 行は { __parseError } で返す)
 * - flush(): 最終 残 buffer を flush (= proc close 時)
 */
class JsonlLineBuffer {
  constructor() {
    this.buffer = '';
  }

  append(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // 最後は incomplete or 空
    const results = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed));
      } catch {
        results.push({ __parseError: true, raw: trimmed });
      }
    }
    return results;
  }

  flush() {
    const trimmed = this.buffer.trim();
    this.buffer = '';
    if (!trimmed) return [];
    try {
      return [JSON.parse(trimmed)];
    } catch {
      return [{ __parseError: true, raw: trimmed }];
    }
  }
}

/**
 * codex JSONL event から user 向け最終 agent message を抽出する pattern (= Light v2 同型)
 *
 * codex は 1 turn で agent_message を multi-emit:
 *   - 中間: thinking aloud / 「次は X を読みます」narration
 *   - 最後の非空: 実 user 向け回答 (要約 / 結論)
 *   - 最後: 空文字列 ("" = turn 終了 signal)
 *
 * 「最後の非空 agent_message を採用」が正しい (= lightV2.js line 246-260 確立済 pattern)。
 */
function isAgentMessageEvent(event) {
  // 一般化: item.completed type === 'agent_message'、もしくは直接 type === 'agent_message'
  if (event && event.type === 'item.completed' && event.item && event.item.type === 'agent_message') {
    return true;
  }
  if (event && event.type === 'agent_message') {
    return true;
  }
  return false;
}

function extractAgentMessageText(event) {
  if (event && event.item && typeof event.item.text === 'string') {
    return event.item.text;
  }
  if (event && typeof event.text === 'string') {
    return event.text;
  }
  return '';
}

/**
 * #292 follow-up (6/13 19:08 テスト（自動) dogfood で Deep Codex も LightV2 と同 pattern
 * の duplicate 確認):
 * LLM が send_message tool で自 room へ post した event か判定 → 真なら最終 auto-post
 * を skip して 2 件返信を防止する flag を立てる。
 *
 * codex CLI JSON event は LightV2 codex SDK と同形式想定:
 * `{ type: 'item.completed', item: { type: 'mcp_tool_call', tool: 'send_message',
 *   status: 'completed', result: { content: [{ type: 'text', text: '{"message":{"room_id":...}}' }] }}}`
 */
function isToolCallSendMessageToOwnRoom(event, roomId) {
  if (!event || event.type !== 'item.completed' || !event.item) return false;
  if (event.item.type !== 'mcp_tool_call') return false;
  if (event.item.tool !== 'send_message') return false;
  if (event.item.status && event.item.status !== 'completed') return false;
  try {
    const text = event.item.result?.content?.[0]?.text;
    if (!text) return false;
    const parsed = JSON.parse(text);
    return parsed?.message?.room_id === roomId;
  } catch {
    return false;
  }
}

/**
 * 長いメッセージを分割 (= deep.js 同型)
 */
function splitMessage(text, maxLength) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  return chunks;
}

/**
 * Deep Codex Agent でメッセージを処理 (= deep.js processDeep の Codex 版 mirror)
 */
async function processDeepCodex({ roomId, prompt, workspacePath, agentId, sessionId, mcpServers, suppressAutoPost = false }) {
  return new Promise((resolve) => {
    // #295: 委譲 (runAgent) 経由は suppressAutoPost=true。自室へ投稿/エラー通知せず本文を
    //       resolve で返し、デリゲーターが委譲元へ機械配送する (委譲先に残さない)。
    const postTarget = (txt) => (suppressAutoPost ? Promise.resolve() : botApi.pushMessage(roomId, txt));
    // MCP servers: 明示指定なければ Light v2 同型 builder で構築 (= tealus + workspace-fs + room/global merge)
    const finalMcpServers = mcpServers || buildLightV2McpConfig(workspacePath);

    // CODEX_HOME 準備 (= auth.json copy + config.toml 生成)
    const codexHomePath = prepareCodexHome(workspacePath, finalMcpServers);

    const useSubscription = (config.DEEP_CODEX_AUTH || 'subscription') === 'subscription';
    const model = config.AGENT_DEEP_CODEX_MODEL || 'gpt-5.4';
    const args = buildCodexExecArgs({ workspacePath, model });
    const spawnEnv = buildCodexExecEnv({
      codexHomePath,
      openaiApiKey: config.OPENAI_API_KEY,
      useSubscription,
    });

    logger.info(`Deep Codex Agent starting: codex ${args.slice(0, 6).join(' ')}... auth=${useSubscription ? 'subscription' : 'api-key'} model=${model}`);
    logger.debug(`Deep Codex Agent full prompt:\n${prompt}`);

    botApi.pushStatus(roomId, 'analyzing', '高度な分析中...').catch(() => {});

    const codexCmd = process.platform === 'win32' ? 'codex.cmd' : 'codex';
    const proc = spawn(codexCmd, args, {
      cwd: workspacePath,
      shell: process.platform === 'win32',
      timeout: config.DEEP_TIMEOUT,
      env: spawnEnv,
    });

    deepRegistry.register(roomId, proc);

    proc.stdin.write(prompt);
    proc.stdin.end();

    proc._tealusCancelled = false;
    proc._tealusWorkspacePath = workspacePath;

    const lineBuffer = new JsonlLineBuffer();
    let lastAgentMessage = null;
    // #292 follow-up: LLM が自 room へ send_message tool で post した場合、最終 auto-post を skip (= 2 件返信防止)
    let llmSentToOwnRoom = false;
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(async () => {
      timedOut = true;
      logger.warn(`Deep Codex Agent timeout (${config.DEEP_TIMEOUT}ms)`);
      await botApi.pushStatus(roomId, 'idle').catch(() => {});
      await postTarget(`⚠ タイムアウトしました（${Math.round(config.DEEP_TIMEOUT / 1000)}秒超過）。タスクが複雑すぎる可能性があります。`).catch(() => {});
      try { proc.kill('SIGTERM'); } catch {}
      if (process.platform === 'win32' && proc.pid) {
        try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { shell: true }); } catch {}
        deepRegistry.sweepByWorkspacePath(workspacePath, roomId);
      }
      // safety net (= deep.js と同型 10s 後 force resolve)
      setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null && !proc._tealusSafetyNetFired) {
          proc._tealusSafetyNetFired = true;
          logger.warn(`Deep Codex Agent safety net fired: process still alive 10s after timeout sweep (room=${roomId}, pid=${proc.pid}). Forcing resolve to unblock room queue.`);
          deepRegistry.unregister(roomId);
          resolve();
        }
      }, 10000);
    }, config.DEEP_TIMEOUT);
    proc._tealusTimer = timer;

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      const events = lineBuffer.append(chunk);
      for (const event of events) {
        if (event.__parseError) continue;
        if (isAgentMessageEvent(event)) {
          const text = extractAgentMessageText(event);
          if (text && text.trim()) {
            lastAgentMessage = text;
          }
        }
        // #292 follow-up: 自 room send_message tool 検出 (= 2 件返信防止 flag)
        if (!llmSentToOwnRoom && isToolCallSendMessageToOwnRoom(event, roomId)) {
          llmSentToOwnRoom = true;
          logger.info(`[DeepCodex] LLM sent_message to own room ${roomId} (= 2 件返信防止 flag、最終 auto-post skip)`);
        }
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      clearTimeout(timer);
      deepRegistry.unregister(roomId);

      // flush 残 buffer
      const finalEvents = lineBuffer.flush();
      for (const event of finalEvents) {
        if (event.__parseError) continue;
        if (isAgentMessageEvent(event)) {
          const text = extractAgentMessageText(event);
          if (text && text.trim()) lastAgentMessage = text;
        }
        if (!llmSentToOwnRoom && isToolCallSendMessageToOwnRoom(event, roomId)) {
          llmSentToOwnRoom = true;
          logger.info(`[DeepCodex] LLM sent_message to own room ${roomId} (= 2 件返信防止 flag、最終 auto-post skip)`);
        }
      }

      // #307: codex が rotation した auth.json を source (~/.codex) に書き戻す。並列 Deep 実行中の
      //       clobber を避けるため sole-running 時 (他室の Deep が無い) のみ。内容不変/壊れた時は no-op。
      if (deepRegistry.count() === 0) {
        writeBackCodexAuth(codexHomePath, getDefaultCodexHome());
      }

      if (proc._tealusCancelled) {
        logger.info(`Deep Codex Agent close after cancel (code ${code}) — skip post-processing`);
        resolve();
        return;
      }

      if (proc._tealusSafetyNetFired) {
        logger.info(`Deep Codex Agent close after safety net (code ${code}) — skip post-processing`);
        resolve();
        return;
      }

      await botApi.pushStatus(roomId, 'idle').catch(() => {});

      if (timedOut) {
        resolve();
        return;
      }

      if (code !== 0 && !lastAgentMessage) {
        // pre-α (#292 follow-up): subscription auth 切れを検出して user に案内
        const authResult = detectCodexAuthError(stderr);
        if (authResult.isAuth) {
          logger.error(`[DeepCodex] auth failed (${authResult.kind}): ${stderr.slice(0, 500)}`);
          await postTarget(buildAuthFailUserMessage());
          resolve(null);
          return;
        }
        logger.error(`Deep Codex Agent failed (code ${code}): ${stderr.slice(0, 200)}`);
        await postTarget(`❌ エラーが発生しました: ${stderr.slice(0, 200) || 'Unknown error'}`);
        resolve(null);
        return;
      }

      if (lastAgentMessage) {
        // #295: 委譲経由は自室投稿せず本文を return (デリゲーターが委譲元へ配送)
        if (suppressAutoPost) {
          logger.info(`[DeepCodex] suppressAutoPost: return ${lastAgentMessage.length} chars without posting to room ${roomId} (delegation)`);
        } else if (llmSentToOwnRoom) {
          // #292 follow-up: LLM が tool で自 room へ既に投函済の場合 auto-post を skip (= 2 件返信防止)
          logger.info(`[DeepCodex] skip auto-post: LLM already sent_message to own room ${roomId} (final response ${lastAgentMessage.length} chars skipped)`);
        } else {
          const content = lastAgentMessage;
          // #303: pushMessage は失敗時に throw する。close ハンドラ内で握らず throw すると
          //       resolve に到達せず Promise がハングするため try/catch で封じ込め、
          //       成功時のみ「sent」、失敗時は「NOT delivered」を明示ログ (偽 sent 防止)。
          try {
            if (content.length > 4000) {
              const chunks = splitMessage(content, 4000);
              for (const chunk of chunks) {
                await botApi.pushMessage(roomId, chunk);
              }
            } else {
              await botApi.pushMessage(roomId, content);
            }
            logger.info(`Deep Codex Agent response sent (${content.length} chars)`);
          } catch (err) {
            logger.error(`[DeepCodex] response NOT delivered to room ${roomId} (${content.length} chars): ${err.message}`);
          }
        }
      } else {
        logger.warn(`Deep Codex Agent close without agent_message (code ${code}), stderr: ${stderr.slice(0, 200)}`);
        await postTarget('応答が取得できませんでした。');
      }
      resolve(lastAgentMessage || null);
    });

    proc.on('error', async (err) => {
      clearTimeout(timer);
      deepRegistry.unregister(roomId);
      await botApi.pushStatus(roomId, 'idle').catch(() => {});
      // pre-α (#292 follow-up): spawn 段階で auth 切れも検出 (= まれ event)
      const authResult = detectCodexAuthError(err.message);
      if (authResult.isAuth) {
        logger.error(`[DeepCodex] spawn auth failed (${authResult.kind}): ${err.message}`);
        await postTarget(buildAuthFailUserMessage());
        resolve(null);
        return;
      }
      logger.error(`Deep Codex Agent spawn error: ${err.message}`);
      await postTarget(`❌ Deep Codex Agent の起動に失敗しました: ${err.message}`);
      resolve(null);
    });
  });
}

module.exports = {
  prepareCodexHome,
  writeBackCodexAuth,
  serializeMcpServersToToml,
  tomlEscape,
  getDefaultCodexHome,
  buildCodexExecArgs,
  buildCodexExecEnv,
  JsonlLineBuffer,
  isAgentMessageEvent,
  extractAgentMessageText,
  splitMessage,
  processDeepCodex,
};
