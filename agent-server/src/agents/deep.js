/**
 * Deep Agent
 * claude -p でMAXプランのClaude Codeを実行
 * --dangerously-skip-permissions で全パーミッション許可
 * --mcp-config で Tealus MCP を接続（自律的コンテキスト取得）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../lib/logger');
const botApi = require('../lib/botApi');
const { updateContext } = require('../context/sessionManager');
const deepRegistry = require('./deepRegistry');

/**
 * Deep Agent 用の MCP 設定を動的生成
 * Tealus MCP + ルーム固有 MCP を統合
 */
function createDeepMcpConfig(workspacePath, roomId) {
  const mcpConfig = {
    mcpServers: {
      tealus: {
        // tealus-mcp は独立 repo (gamasenninn/tealus-mcp) に分離済 (#187)。
        // npx の GitHub 直接 install で取得する (zero-config、認証不要)。
        command: 'npx',
        args: ['-y', 'github:gamasenninn/tealus-mcp#v0.14.5'],
        env: {
          TEALUS_API_URL: config.TEALUS_API_URL,
          TEALUS_USER_ID: config.TEALUS_BOT_ID,
          TEALUS_PASSWORD: config.TEALUS_BOT_PASS,
          // generate_and_send_image (#260) で DALL-E 3 を呼ぶため必要
          ...(config.OPENAI_API_KEY ? { OPENAI_API_KEY: config.OPENAI_API_KEY } : {}),
          // read_document の vision fallback (Gemini) で必要
          ...(process.env.GOOGLE_API_KEY ? { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY } : {}),
          ...(process.env.DOCUMENT_VISION_PROVIDER ? { DOCUMENT_VISION_PROVIDER: process.env.DOCUMENT_VISION_PROVIDER } : {}),
          ...(process.env.DOCUMENT_VISION_MODEL ? { DOCUMENT_VISION_MODEL: process.env.DOCUMENT_VISION_MODEL } : {}),
          ...(process.env.DOCUMENT_VISION_MAX_PAGES ? { DOCUMENT_VISION_MAX_PAGES: process.env.DOCUMENT_VISION_MAX_PAGES } : {}),
        },
      },
    },
  };

  // ルーム固有 MCP があればマージ
  const roomMcpPath = path.join(workspacePath, 'mcp_config.json');
  if (fs.existsSync(roomMcpPath)) {
    try {
      const roomMcp = JSON.parse(fs.readFileSync(roomMcpPath, 'utf8'));
      Object.assign(mcpConfig.mcpServers, roomMcp.mcpServers || {});
    } catch (err) {
      logger.warn(`Failed to load room MCP config: ${err.message}`);
    }
  }

  const configPath = path.join(workspacePath, '.deep_mcp_config.json');
  fs.writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2));
  logger.debug(`Deep MCP config created: ${configPath} (${Object.keys(mcpConfig.mcpServers).length} servers)`);
  return configPath;
}

/**
 * claude -p の引数を構築
 */
function buildClaudeArgs({ workspacePath, sessionId }) {
  const args = ['-p', '-', '--dangerously-skip-permissions'];

  // 動的生成された MCP 設定
  const mcpConfigPath = path.join(workspacePath, '.deep_mcp_config.json');
  if (fs.existsSync(mcpConfigPath)) {
    args.push('--mcp-config', mcpConfigPath);
  }

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  return args;
}

/**
 * Deep Agent でメッセージを処理
 */
async function processDeep({ roomId, prompt, workspacePath, agentId, sessionId }) {
  return new Promise((resolve) => {
    // MCP 設定を動的生成（Tealus MCP + ルーム固有 MCP）
    createDeepMcpConfig(workspacePath, roomId);

    const args = buildClaudeArgs({ workspacePath, sessionId });

    logger.info(`Deep Agent starting: claude ${args.join(' ').slice(0, 100)}...`);
    logger.debug(`Deep Agent full prompt:\n${prompt}`);

    botApi.pushStatus(roomId, 'analyzing', '高度な分析中...').catch(() => {});

    // Windows では .cmd を使う
    const claudeCmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    const proc = spawn(claudeCmd, args, {
      cwd: workspacePath,
      shell: process.platform === 'win32',
      timeout: config.DEEP_TIMEOUT,
      env: { ...process.env, HOME: workspacePath },
    });

    // #250: cancel 用に registry に登録 (close/error/timeout で必ず unregister)
    deepRegistry.register(roomId, proc);

    // stdin からプロンプトを渡す
    proc.stdin.write(prompt);
    proc.stdin.end();

    // #250 follow-up: registry.cancel から timer を clear / cancel flag を立てるための reference
    proc._tealusCancelled = false;
    // #252: cancel 時に CommandLine 一致で sweep kill するため workspace path を expose
    proc._tealusWorkspacePath = workspacePath;

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // タイムアウト管理 — registry.cancel から clearTimeout できるよう proc 経由で参照可能に
    const timer = setTimeout(async () => {
      timedOut = true;
      logger.warn(`Deep Agent timeout (${config.DEEP_TIMEOUT}ms)`);
      // Windows では SIGTERM が効かない場合があるので、先にメッセージを送る
      await botApi.pushStatus(roomId, 'idle').catch(() => {});
      await botApi.pushMessage(roomId, `⚠ タイムアウトしました（${Math.round(config.DEEP_TIMEOUT / 1000)}秒超過）。タスクが複雑すぎる可能性があります。`).catch(() => {});
      try { proc.kill('SIGTERM'); } catch {}
      // Windows のシェルプロセスを強制終了
      if (process.platform === 'win32' && proc.pid) {
        try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { shell: true }); } catch {}
        // #252 と同型: cmd.exe → claude.cmd → claude.exe tree で taskkill /T /F が race により
        // claude.exe を取り逃すケースに対応。cancel path (deepRegistry.cancel) と同じ PowerShell
        // sweep を timeout path にも適用 (5/11 user 報告 bug の root cause、Step 27 follow-up)
        deepRegistry.sweepByWorkspacePath(workspacePath, roomId);
      }
      // Promise safety net: sweep + close 経路が race で fail した worst case でも room queue を
      // blocking しないよう、10s 後に proc が依然生きていれば強制 resolve する構造保険。
      // 通常 path では sweep effective + close 1-2s 以内発火、本 net は出ない想定。
      setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null && !proc._tealusSafetyNetFired) {
          proc._tealusSafetyNetFired = true;
          logger.warn(`Deep Agent safety net fired: process still alive 10s after timeout sweep (room=${roomId}, pid=${proc.pid}). Forcing resolve to unblock room queue.`);
          deepRegistry.unregister(roomId);
          resolve();
        }
      }, 10000);
    }, config.DEEP_TIMEOUT);
    proc._tealusTimer = timer;

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      // 進捗検知: 長い出力の途中でステータス更新
      if (stdout.length > 500 && stdout.length % 1000 < chunk.length) {
        botApi.pushStatus(roomId, 'analyzing', '分析中...').catch(() => {});
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      clearTimeout(timer);
      deepRegistry.unregister(roomId);

      // #250: cancel 経由なら cancel route 側で「⏹ 分析を中断しました。」+ idle 配信済、
      // 重複 message や ❌ エラー message を出さない
      if (proc._tealusCancelled) {
        logger.info(`Deep Agent close after cancel (code ${code}) — skip post-processing`);
        resolve();
        return;
      }

      // safety net path: timeout の後 10s 経過で強制 resolve 済、close は遅延発火。
      // 「⚠ タイムアウトしました...」message は timer callback で送信済なので二重投下を避ける
      if (proc._tealusSafetyNetFired) {
        logger.info(`Deep Agent close after safety net (code ${code}) — skip post-processing`);
        resolve();
        return;
      }

      await botApi.pushStatus(roomId, 'idle').catch(() => {});

      if (timedOut) {
        // #303: pushMessage は失敗時 throw。close ハンドラ内なので resolve 到達前の throw を防ぐ
        await botApi.pushMessage(roomId, `⚠ タイムアウトしました（${Math.round(config.DEEP_TIMEOUT / 1000)}秒超過）。タスクが複雑すぎる可能性があります。`)
          .catch((err) => logger.error(`[Deep] timeout notice NOT delivered to room ${roomId}: ${err.message}`));
        resolve();
        return;
      }

      if (code !== 0 && !stdout) {
        logger.error(`Deep Agent failed (code ${code}): ${stderr.slice(0, 200)}`);
        await botApi.pushMessage(roomId, `❌ エラーが発生しました: ${stderr.slice(0, 200) || 'Unknown error'}`)
          .catch((err) => logger.error(`[Deep] error notice NOT delivered to room ${roomId}: ${err.message}`));
        resolve();
        return;
      }

      // 応答を送信
      const response = stdout.trim();
      if (response) {
        // #303: throw でハングしないよう try/catch、成功時のみ sent ログ
        try {
          if (response.length > 4000) {
            const chunks = splitMessage(response, 4000);
            for (const chunk of chunks) {
              await botApi.pushMessage(roomId, chunk);
            }
          } else {
            await botApi.pushMessage(roomId, response);
          }
          logger.info(`Deep Agent response sent (${response.length} chars)`);
        } catch (err) {
          logger.error(`[Deep] response NOT delivered to room ${roomId} (${response.length} chars): ${err.message}`);
        }
      }

      resolve();
    });

    proc.on('error', async (err) => {
      clearTimeout(timer);
      deepRegistry.unregister(roomId);
      await botApi.pushStatus(roomId, 'idle').catch(() => {});
      logger.error(`Deep Agent spawn error: ${err.message}`);
      await botApi.pushMessage(roomId, `❌ Deep Agent の起動に失敗しました: ${err.message}`)
        .catch((e) => logger.error(`[Deep] spawn-error notice NOT delivered to room ${roomId}: ${e.message}`));
      resolve();
    });
  });
}

/**
 * 長いメッセージを分割
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

module.exports = { processDeep, buildClaudeArgs, splitMessage, createDeepMcpConfig };
