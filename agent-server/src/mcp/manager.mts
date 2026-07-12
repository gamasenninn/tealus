/**
 * MCPサーバー ライフサイクル管理
 * 起動時にconnect、終了時にclose
 */
import { MCPServerStdio } from '@openai/agents';
import { logger } from '../lib/logger.mts';
import fs from 'node:fs';
import path from 'node:path';

interface McpServerDef {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfigFile {
  mcpServers?: Record<string, McpServerDef>;
}

let connectedServers: MCPServerStdio[] = [];

/**
 * MCP設定ファイルからサーバーを読み込んで接続
 */
export async function connectMcpServers(): Promise<MCPServerStdio[]> {
  const configPath = path.join(import.meta.dirname, '..', '..', 'mcp_config.json');

  if (!fs.existsSync(configPath)) {
    logger.info('MCP config not found, skipping MCP initialization');
    return [];
  }

  try {
    const mcpConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as McpConfigFile;
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
        logger.error(`MCP '${name}' connection failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return connectedServers;
  } catch (err) {
    logger.error(`MCP config parse error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * 全MCPサーバーを切断
 */
export async function disconnectAll(): Promise<void> {
  for (const server of connectedServers) {
    try {
      await server.close();
    } catch (err) {
      logger.debug(`MCP close error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  connectedServers = [];
  logger.info('All MCP servers disconnected');
}

/**
 * 接続済みサーバー一覧を取得
 */
export function getConnectedServers(): MCPServerStdio[] {
  return connectedServers;
}
