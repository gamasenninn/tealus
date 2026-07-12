/**
 * ファイルベースメモリ管理（Light Agent用）
 * Deep Agent は Claude Code 内蔵メモリを使うので、このラッパーは Light 専用
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * MEMORY.md を読み込む
 */
export function readMemory(workspacePath: string): string {
  const memoryPath = path.join(workspacePath, 'memory', 'MEMORY.md');
  try {
    if (fs.existsSync(memoryPath)) {
      return fs.readFileSync(memoryPath, 'utf8');
    }
  } catch { /* ignore */ }
  return '';
}

/**
 * メモリファイルに書き込む
 */
export function writeMemory(workspacePath: string, name: string, content: string): void {
  const memoryDir = path.join(workspacePath, 'memory');
  try {
    fs.mkdirSync(memoryDir, { recursive: true });
    const filePath = path.join(memoryDir, `${name}.md`);
    fs.writeFileSync(filePath, content, 'utf8');
  } catch { /* ignore */ }
}

/**
 * メモリインデックスと関連ファイルを読み込んでプロンプト用テキストを生成
 */
export function loadMemoryForPrompt(workspacePath: string): string {
  const memoryDir = path.join(workspacePath, 'memory');
  let result = '';

  // MEMORY.md を読む
  const index = readMemory(workspacePath);
  if (!index) return '';

  result += index + '\n\n';

  // インデックスからリンクされたファイルを読む
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(index)) !== null) {
    const fileName = match[2];
    const filePath = path.join(memoryDir, fileName);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        result += `--- ${fileName} ---\n${content}\n\n`;
      }
    } catch { /* ignore */ }
  }

  return result.trim();
}
