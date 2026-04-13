/**
 * Light Agent カスタムツール定義
 */
const { tool } = require('@openai/agents');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const { writeMemory, readMemory } = require('../memory/fileMemory');

/**
 * ワークスペース用のカスタムツール一覧を作成
 */
function createTools(workspacePath) {
  const tools = [];

  // メモリ書き込み
  tools.push(tool({
    name: 'write_memory',
    description: 'ユーザーについて覚えておくべき情報を保存する。名前、好み、役職、プロジェクト状況など。',
    parameters: z.object({
      name: z.string().describe('メモリファイル名（拡張子なし、例: user_tanaka）'),
      content: z.string().describe('保存する内容'),
    }),
    execute: async ({ name, content }) => {
      writeMemory(workspacePath, name, content);
      // MEMORY.md のインデックスも更新
      const indexPath = path.join(workspacePath, 'memory', 'MEMORY.md');
      const index = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '## Memory Index\n';
      if (!index.includes(`${name}.md`)) {
        const entry = `- [${name}.md](${name}.md) — ${content.slice(0, 50)}\n`;
        fs.writeFileSync(indexPath, index + entry);
      }
      logger.debug(`Memory written: ${name}`);
      return `メモリ「${name}」を保存しました`;
    },
  }));

  // メモリ読み込み
  tools.push(tool({
    name: 'read_memory',
    description: 'ユーザーについて以前保存した情報を読み込む。',
    parameters: z.object({
      name: z.string().describe('メモリファイル名（拡張子なし）'),
    }),
    execute: async ({ name }) => {
      const filePath = path.join(workspacePath, 'memory', `${name}.md`);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
      }
      return `メモリ「${name}」は見つかりませんでした`;
    },
  }));

  // 現在時刻取得
  tools.push(tool({
    name: 'get_current_time',
    description: '現在の日時を取得する。',
    parameters: z.object({}),
    execute: async () => {
      const now = new Date();
      return now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    },
  }));

  // ファイル一覧
  tools.push(tool({
    name: 'list_workspace_files',
    description: 'ワークスペース内のファイル一覧を取得する。',
    parameters: z.object({
      subdir: z.string().optional().describe('サブディレクトリ（省略時はルート）'),
    }),
    execute: async ({ subdir }) => {
      const dir = subdir ? path.join(workspacePath, subdir) : workspacePath;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n') || '(空)';
      } catch {
        return 'ディレクトリが見つかりません';
      }
    },
  }));

  return tools;
}

module.exports = { createTools };
