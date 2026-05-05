/**
 * Light Agent カスタムツール定義
 */
const { tool } = require('@openai/agents');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const config = require('../config');
const botApi = require('../lib/botApi');
const { writeMemory, readMemory } = require('../memory/fileMemory');
const { getSetting } = require('../context/settingsManager');

/**
 * ワークスペース用のカスタムツール一覧を作成
 */
function createTools(workspacePath, roomId) {
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

  // text を file としてチャットに添付投稿 (#244)
  // OCR 結果 / 整形 text / 生成 markdown 等を user が DL できる形で届けるため
  if (roomId) {
    tools.push(tool({
      name: 'share_text_as_file',
      description: 'OCR 結果、要約、変換 text 等を **file としてチャットに添付投稿** する。長文や保存したい内容、後で参照したい text に使う。短い回答や口頭応答には不要。mime type は filename 拡張子から自動推測 (.txt/.md/.csv/.json/.html 等)。\n\n**重要**: この tool は file を直接チャットに添付メッセージとして投稿する。user は file message そのものを click で DL する。応答テキストには **download link を書かないこと** (実 URL を持っていない、書くと hallucinated link になる)。短く「○○を添付しました」と acknowledge するだけで十分。`sandbox:/mnt/data/...` 等の URL は training data の artifact なので絶対に書かない。',
      parameters: z.object({
        filename: z.string().describe('file 名 (拡張子付き、ex: "ocr_result.txt", "summary.md", "data.csv")'),
        content: z.string().describe('file の本文 text'),
      }),
      execute: async ({ filename, content }) => {
        try {
          // filename 拡張子から mime 推測
          const ext = (filename.split('.').pop() || '').toLowerCase();
          const mimeMap = {
            txt: 'text/plain',
            md: 'text/markdown',
            csv: 'text/csv',
            json: 'application/json',
            html: 'text/html',
            xml: 'text/xml',
            log: 'text/plain',
          };
          const mt = mimeMap[ext] || 'text/plain';
          const buffer = Buffer.from(content, 'utf8');
          await botApi.pushFile(roomId, buffer, filename, mt, '');
          logger.info(`[ShareFile] ${filename} (${mt}, ${buffer.length} bytes) → room ${roomId}`);
          // #245: hallucination 防止のため、return text で「link 書くな」を明示
          return `file をチャットに添付しました。応答テキストには download link を書かないでください (実 URL を持っていません)。user は file message を click で DL します。短く「${filename} を添付しました」と acknowledge するだけで十分。`;
        } catch (err) {
          logger.error(`[ShareFile] failed: ${err.message}`);
          return `file 送信に失敗しました: ${err.message}`;
        }
      },
    }));
  }

  // ファイル一覧
  tools.push(tool({
    name: 'list_workspace_files',
    description: 'ワークスペース内のファイル一覧を取得する。subdirでサブディレクトリ指定（空文字でルート）。',
    parameters: z.object({
      subdir: z.string().describe('サブディレクトリ（ルートの場合は空文字）'),
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

  // 画像生成（DALL-E）
  if (roomId && getSetting('tool_generate_image', true)) {
    tools.push(tool({
      name: 'generate_image',
      description: '指定されたプロンプトに基づいて画像を生成する。風景、動物、イラスト、図解など何でも生成可能。',
      parameters: z.object({
        prompt: z.string().describe('画像生成のプロンプト（英語推奨。日本語でも可）'),
      }),
      execute: async ({ prompt }) => {
        try {
          await botApi.pushStatus(roomId, 'generating', '画像生成中...').catch(() => {});
          logger.info(`[Image] Generating: ${prompt.slice(0, 80)}`);
          const res = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-image-1',
              prompt,
              n: 1,
              size: '1024x1024',
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error?.message || 'Image generation failed');

          const image = data.data[0];
          let buffer;
          if (image.b64_json) {
            buffer = Buffer.from(image.b64_json, 'base64');
          } else if (image.url) {
            const imgRes = await fetch(image.url);
            buffer = Buffer.from(await imgRes.arrayBuffer());
          } else {
            throw new Error('No image data in response');
          }

          const filename = `generated_${Date.now()}.png`;
          await botApi.pushImage(roomId, buffer, filename);
          logger.info(`[Image] Generated and sent (${buffer.length} bytes)`);
          return '画像を生成してチャットに送信しました。';
        } catch (err) {
          logger.error(`[Image] Generation failed: ${err.message}`);
          return `画像生成に失敗しました: ${err.message}`;
        }
      },
    }));
  }

  return tools;
}

module.exports = { createTools };
