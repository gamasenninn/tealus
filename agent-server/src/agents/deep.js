/**
 * Deep Agent
 * claude -p でMAXプランのClaude Codeを実行
 * --dangerously-skip-permissions で全パーミッション許可
 * --cwd でワークスペースに閉じ込め
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../lib/logger');
const botApi = require('../lib/botApi');
const { updateContext } = require('../context/sessionManager');

/**
 * claude -p の引数を構築
 */
function buildClaudeArgs({ prompt, workspacePath, sessionId }) {
  const args = ['-p', prompt, '--dangerously-skip-permissions'];

  // ルーム固有 mcp_config.json があれば渡す
  if (workspacePath) {
    const mcpConfigPath = path.join(workspacePath, 'mcp_config.json');
    if (fs.existsSync(mcpConfigPath)) {
      args.push('--mcp-config', mcpConfigPath);
    }
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
    const args = buildClaudeArgs({ prompt, workspacePath, sessionId });

    logger.info(`Deep Agent starting: claude ${args.join(' ').slice(0, 100)}...`);

    // Windows では .cmd を使う
    const claudeCmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    const proc = spawn(claudeCmd, args, {
      cwd: workspacePath,
      shell: process.platform === 'win32',
      timeout: config.DEEP_TIMEOUT,
      env: { ...process.env, HOME: workspacePath },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // タイムアウト管理
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      logger.warn(`Deep Agent timeout (${config.DEEP_TIMEOUT}ms)`);
    }, config.DEEP_TIMEOUT);

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      // 進捗検知: 長い出力の途中でチェックポイント報告
      if (stdout.length > 500 && stdout.length % 1000 < chunk.length) {
        botApi.pushMessage(roomId, '📊 処理中...').catch(() => {});
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      clearTimeout(timer);

      if (timedOut) {
        await botApi.pushMessage(roomId, `⚠ タイムアウトしました（${Math.round(config.DEEP_TIMEOUT / 1000)}秒超過）。タスクが複雑すぎる可能性があります。`);
        resolve();
        return;
      }

      if (code !== 0 && !stdout) {
        logger.error(`Deep Agent failed (code ${code}): ${stderr.slice(0, 200)}`);
        await botApi.pushMessage(roomId, `❌ エラーが発生しました: ${stderr.slice(0, 200) || 'Unknown error'}`);
        resolve();
        return;
      }

      // 応答を送信
      const response = stdout.trim();
      if (response) {
        // 長い応答は分割
        if (response.length > 4000) {
          const chunks = splitMessage(response, 4000);
          for (const chunk of chunks) {
            await botApi.pushMessage(roomId, chunk);
          }
        } else {
          await botApi.pushMessage(roomId, response);
        }
        logger.info(`Deep Agent response sent (${response.length} chars)`);
      }

      // セッションID抽出・保存（stdout からパース）
      // claude -p は session_id を出力する場合がある
      // TODO: stream-json モードで正確に抽出

      resolve();
    });

    proc.on('error', async (err) => {
      clearTimeout(timer);
      logger.error(`Deep Agent spawn error: ${err.message}`);
      await botApi.pushMessage(roomId, `❌ Deep Agent の起動に失敗しました: ${err.message}`);
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

module.exports = { processDeep, buildClaudeArgs, splitMessage };
