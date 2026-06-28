/**
 * ルームごとの動的MCP接続キャッシュ
 *
 * MCP構成:
 * 1. filesystem MCP: ルームごとに自動生成（ワークスペースがルート）
 * 2. ルーム固有MCP: workspace/mcp_config.json（任意）
 * 3. グローバルMCP: agent-server/mcp_config.json（全ルーム共有、1プロセスのみ）
 */
const { MCPServerStdio } = require('@openai/agents');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../lib/logger');

// ルーム固有キャッシュ: key = "${agentId}:${roomId}"
const roomMcpCache = new Map();
// グローバルMCP共有キャッシュ（全ルームで1セット）
let sharedGlobalServers = null;
let sweepTimer = null;

// MCP server connect timeout (#226 Phase C → #227 完全 fix)
// MCPServerStdio には 2 種類の timeout option がある:
//   - timeout (ms): listTools / callTool 等の request method timeout
//   - clientSessionTimeoutSeconds (秒): connect (initialize handshake) timeout、default 5s
// #226 では timeout のみ渡したが connect には効かず、採用者環境で 5s timeout が出続けた。
// 本 fix では両方渡す (#227)。
const MCP_CONNECT_TIMEOUT = 30000;          // request timeout (ms)
const MCP_CONNECT_TIMEOUT_SECONDS = 30;     // connect/initialize timeout (秒)

/**
 * グローバルMCPサーバーを取得（初回のみ接続）
 *
 * 構成:
 * 1. Tealus MCP (programmatic): TEALUS_BOT_ID/PASS が設定されていれば自動追加
 *    Deep agent (agents/deep.js) と同じ npx 経由で組織記憶ツールに access (#199)
 * 2. agent-server/mcp_config.json: user カスタム MCP 用 (filesystem は除外)
 */
async function getOrCreateSharedGlobal() {
  if (sharedGlobalServers) return sharedGlobalServers;

  const servers = [];

  // 1. Tealus MCP (#199、Bot 認証情報があれば追加)
  if (config.TEALUS_BOT_ID && config.TEALUS_BOT_PASS) {
    try {
      const tealusServer = new MCPServerStdio({
        name: 'tealus',
        command: 'npx',
        args: ['-y', 'github:gamasenninn/tealus-mcp#v0.14.7'],
        env: {
          ...process.env,  // PATH 等の親 env を継承 (npx 実行に必須)
          TEALUS_API_URL: config.TEALUS_API_URL,
          TEALUS_USER_ID: config.TEALUS_BOT_ID,
          TEALUS_PASSWORD: config.TEALUS_BOT_PASS,
        },
        timeout: MCP_CONNECT_TIMEOUT,                              // request timeout (ms)
        clientSessionTimeoutSeconds: MCP_CONNECT_TIMEOUT_SECONDS,  // #227 connect timeout (秒)
      });
      await tealusServer.connect();
      servers.push(tealusServer);
      logger.info('[RoomMCP] tealus MCP connected (shared global)');
    } catch (err) {
      logger.error(`[RoomMCP] tealus MCP connect failed: ${err.message}`);
    }
  } else {
    logger.debug('[RoomMCP] Tealus MCP skipped (TEALUS_BOT_ID/PASS not set)');
  }

  // 2. agent-server/mcp_config.json (user カスタム)
  const globalConfigPath = path.join(__dirname, '..', '..', 'mcp_config.json');
  if (fs.existsSync(globalConfigPath)) {
    try {
      const globalConfig = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
      if (globalConfig.mcpServers) {
        // filesystem はルームごとに自動生成するのでグローバルからは除外
        const filtered = {};
        for (const [name, def] of Object.entries(globalConfig.mcpServers)) {
          if (name !== 'filesystem') filtered[name] = def;
        }
        const userServers = await connectFromConfig(filtered, 'global');
        servers.push(...userServers);
      }
    } catch (err) {
      logger.error(`[RoomMCP] Global config error: ${err.message}`);
    }
  }

  sharedGlobalServers = servers;
  logger.info(`[RoomMCP] Shared global: ${sharedGlobalServers.length} servers connected`);
  return sharedGlobalServers;
}

/**
 * ルーム用のMCPサーバー一覧を取得（キャッシュ付き）
 */
async function getOrCreateRoomMcp(agentId, roomId, workspacePath) {
  const key = `${agentId}:${roomId}`;

  if (roomMcpCache.has(key)) {
    const entry = roomMcpCache.get(key);
    entry.lastAccessedAt = Date.now();
    // ルーム固有 + 共有グローバルをマージして返す
    const globalServers = await getOrCreateSharedGlobal();
    return [...entry.servers, ...globalServers];
  }

  logger.info(`[RoomMCP] Creating MCP connections for ${key}`);
  const servers = [];

  // ルーム固有 mcp_config.json を先に読む（filesystem重複チェック用）
  const roomConfigPath = path.join(workspacePath, 'mcp_config.json');
  let roomConfig = {};
  if (fs.existsSync(roomConfigPath)) {
    try {
      roomConfig = JSON.parse(fs.readFileSync(roomConfigPath, 'utf8'));
    } catch (err) {
      logger.error(`[RoomMCP] Room config parse error: ${err.message}`);
    }
  }

  const hasCustomFilesystem = !!roomConfig.mcpServers?.filesystem;

  // 1. filesystem MCP（カスタムfilesystemがなければ自動生成、#226 で npx 経由に変更）
  if (!hasCustomFilesystem) {
    try {
      const normalizedPath = path.resolve(workspacePath).replace(/\\/g, '/');
      const fsServer = new MCPServerStdio({
        name: 'tealus-workspace-fs',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', normalizedPath],
        env: { ...process.env },
        timeout: MCP_CONNECT_TIMEOUT,                              // request timeout (ms)
        clientSessionTimeoutSeconds: MCP_CONNECT_TIMEOUT_SECONDS,  // #227 connect timeout (秒)
      });
      await fsServer.connect();
      servers.push(fsServer);
      logger.info(`[RoomMCP] filesystem connected: ${normalizedPath}`);
    } catch (err) {
      logger.error(`[RoomMCP] filesystem connect failed: ${err.message}`);
    }
  }

  // 2. ルーム固有 mcp_config.json
  if (roomConfig.mcpServers) {
    const roomServers = await connectFromConfig(roomConfig.mcpServers, `room-${roomId}`);
    servers.push(...roomServers);
  }

  // ルーム固有サーバーのみキャッシュ（グローバルは共有）
  roomMcpCache.set(key, {
    servers,
    lastAccessedAt: Date.now(),
    workspacePath,
  });

  // 3. グローバルMCP（共有）
  const globalServers = await getOrCreateSharedGlobal();

  logger.info(`[RoomMCP] ${key}: ${servers.length} room + ${globalServers.length} shared servers`);
  return [...servers, ...globalServers];
}

/**
 * mcp_config.json の mcpServers 定義からMCPサーバーを接続
 */
async function connectFromConfig(serverDefs, prefix) {
  const servers = [];
  for (const [name, def] of Object.entries(serverDefs)) {
    if (!def.command) continue;
    try {
      const fullCommand = [def.command, ...(def.args || [])].join(' ');
      const server = new MCPServerStdio({
        name: `${prefix}-${name}`,
        fullCommand,
        // #240: parent env を継承 + def.env で override
        // (TAVILY_API_KEY 等の API key を必要とする user MCP のため必須)
        env: { ...process.env, ...(def.env || {}) },
        timeout: MCP_CONNECT_TIMEOUT,                              // request timeout (ms)
        clientSessionTimeoutSeconds: MCP_CONNECT_TIMEOUT_SECONDS,  // #227 connect timeout (秒)
      });
      await server.connect();
      servers.push(server);
      logger.debug(`[RoomMCP] ${prefix}-${name} connected`);
    } catch (err) {
      logger.error(`[RoomMCP] ${prefix}-${name} failed: ${err.message}`);
    }
  }
  return servers;
}

/**
 * TTLスイーパー開始
 */
function startSweeper() {
  sweepTimer = setInterval(async () => {
    const now = Date.now();
    for (const [key, entry] of roomMcpCache) {
      if (now - entry.lastAccessedAt > config.MCP_CACHE_TTL) {
        logger.info(`[RoomMCP] Evicting expired: ${key}`);
        await closeEntry(entry);
        roomMcpCache.delete(key);
      }
    }
  }, config.MCP_SWEEP_INTERVAL);
}

/**
 * TTLスイーパー停止
 */
function stopSweeper() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/**
 * 特定ルームのMCPキャッシュを無効化（次回アクセス時に再接続）
 */
async function invalidateRoomMcp(agentId, roomId) {
  const key = `${agentId}:${roomId}`;
  if (roomMcpCache.has(key)) {
    const entry = roomMcpCache.get(key);
    await closeEntry(entry);
    roomMcpCache.delete(key);
    logger.info(`[RoomMCP] Invalidated: ${key}`);
  }
}

/**
 * 全MCP接続を切断
 */
async function closeAllRoomMcp() {
  stopSweeper();
  // ルーム固有サーバーを close
  for (const [key, entry] of roomMcpCache) {
    await closeEntry(entry);
  }
  roomMcpCache.clear();

  // 共有グローバルサーバーを close
  if (sharedGlobalServers) {
    for (const server of sharedGlobalServers) {
      try { await server.close(); } catch (e) { /* ignore */ }
    }
    sharedGlobalServers = null;
  }

  logger.info('[RoomMCP] All room MCP connections closed');
}

/**
 * エントリの全サーバーをclose
 */
async function closeEntry(entry) {
  for (const server of entry.servers) {
    try { await server.close(); } catch (e) { /* ignore */ }
  }
}

module.exports = {
  getOrCreateRoomMcp,
  invalidateRoomMcp,
  closeAllRoomMcp,
  startSweeper,
  stopSweeper,
};
