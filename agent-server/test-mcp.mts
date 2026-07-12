/**
 * MCP連携テストスクリプト
 * filesystem MCPサーバーを使ってLight AgentのMCP動作を確認
 */
import 'dotenv/config';
import { Agent, run, MCPServerStdio } from '@openai/agents';

async function main() {
  console.log('MCP テスト開始...');

  // filesystem MCP サーバーを設定
  const fsServer = new MCPServerStdio({
    name: 'filesystem',
    fullCommand: 'npx -y @modelcontextprotocol/server-filesystem ./agent-workspaces',
  });

  try {
    // MCPサーバーに接続
    console.log('MCP サーバー接続中...');
    await fsServer.connect();
    console.log('MCP サーバー接続完了');

    // 利用可能なツール一覧を表示
    const tools = await fsServer.listTools();
    console.log(`利用可能ツール: ${tools.length}個`);
    for (const t of tools) {
      console.log(`  - ${t.name}: ${t.description?.slice(0, 50)}`);
    }

    // Agent作成（MCP付き）
    const agent = new Agent({
      name: 'TestAssistant',
      instructions: 'あなたはファイル操作ができるアシスタントです。日本語で応答してください。',
      model: process.env.AGENT_LIGHT_MODEL || 'gpt-4o-mini',
      mcpServers: [fsServer],
    });

    console.log('\nクエリ実行中...');

    // テスト: ディレクトリ内容を確認
    const result = await run(agent, 'agent-workspacesディレクトリにどんなファイルやフォルダがあるか教えて');

    console.log('\n=== 応答 ===');
    console.log(result.finalOutput);
    console.log('=============\n');

  } catch (err) {
    console.error('エラー:', err instanceof Error ? err.message : err);
    if (err instanceof Error) console.error(err.stack);
  } finally {
    // MCPサーバー切断
    await fsServer.close().catch(() => {});
  }

  process.exit(0);
}

main();
