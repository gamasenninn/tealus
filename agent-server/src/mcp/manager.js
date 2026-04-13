/**
 * MCPサーバー ライフサイクル管理
 * 起動時にconnect、終了時にclose
 */
const { MCPServerStdio } = require('@openai/agents');
const logger = require('../lib/logger');
const config = require('../config');
const fs = require('fs');
const path = require('path');

let connectedServers = [];

/**
 * MCP設定ファイルからサーバーを読み込んで接続
 */
async function connectMcpServers() {
  const configPath = path.join(__dirname, '..', '..', 'mcp_config.json');

  if (!fs.existsSync(configPath)) {
    logger.info('MCP config not found, skipping MCP initialization');
    return [];
  }

  try {
    const mcpConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const serverDefs = mcpConfig.mcpServers || {};

    for (const [name, def] of Object.entries(serverDefs)) {
      if (!def.command) {
        logger.warn(`MCP server '${name}': no command specified`);
        continue;
      }

      try {
        const fullCommand = [def.command, ...(def.args || [])].join(' ');
        const server = new MCPServerStdio({
          name,
          fullCommand,
        });

        await server.connect();
        connectedServers.push(server);

        const tools = await server.listTools();
        logger.info(`MCP '${name}' connected (${tools.length} tools)`);
        for (const t of tools) {
          logger.debug(`  - ${t.name}`);
        }
      } catch (err) {
        logger.error(`MCP '${name}' connection failed: ${err.message}`);
      }
    }

    return connectedServers;
  } catch (err) {
    logger.error(`MCP config parse error: ${err.message}`);
    return [];
  }
}

/**
 * 全MCPサーバーを切断
 */
async function disconnectAll() {
  for (const server of connectedServers) {
    try {
      await server.close();
    } catch (err) {
      logger.debug(`MCP close error: ${err.message}`);
    }
  }
  connectedServers = [];
  logger.info('All MCP servers disconnected');
}

/**
 * 接続済みサーバー一覧を取得
 */
function getConnectedServers() {
  return connectedServers;
}

module.exports = { connectMcpServers, disconnectAll, getConnectedServers };
