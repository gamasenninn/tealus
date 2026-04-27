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
        args: ['-y', 'github:gamasenninn/tealus-mcp'],
        env: {
          TEALUS_API_URL: config.TEALUS_API_URL,
          TEALUS_USER_ID: config.TEALUS_BOT_ID,
          TEALUS_PASSWORD: config.TEALUS_BOT_PASS,
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

    botApi.pushStatus(roomId, 'thinking', '高度な分析中...').catch(() => {});

    // Windows では .cmd を使う
    const claudeCmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    const proc = spawn(claudeCmd, args, {
      cwd: workspacePath,
      shell: process.platform === 'win32',
      timeout: config.DEEP_TIMEOUT,
      env: { ...process.env, HOME: workspacePath },
    });

    // stdin からプロンプトを渡す
    proc.stdin.write(prompt);
    proc.stdin.end();

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // タイムアウト管理
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
      }
    }, config.DEEP_TIMEOUT);

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      // 進捗検知: 長い出力の途中でステータス更新
      if (stdout.length > 500 && stdout.length % 1000 < chunk.length) {
        botApi.pushStatus(roomId, 'thinking', '分析中...').catch(() => {});
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      clearTimeout(timer);
      await botApi.pushStatus(roomId, 'idle').catch(() => {});

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

      resolve();
    });

    proc.on('error', async (err) => {
      clearTimeout(timer);
      await botApi.pushStatus(roomId, 'idle').catch(() => {});
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

module.exports = { processDeep, buildClaudeArgs, splitMessage, createDeepMcpConfig };
