/**
 * ファイルベースメモリ管理（Light Agent用）
 * Deep Agent は Claude Code 内蔵メモリを使うので、このラッパーは Light 専用
 */
const fs = require('fs');
const path = require('path');

/**
 * MEMORY.md を読み込む
 */
function readMemory(workspacePath) {
  const memoryPath = path.join(workspacePath, 'memory', 'MEMORY.md');
  try {
    if (fs.existsSync(memoryPath)) {
      return fs.readFileSync(memoryPath, 'utf8');
    }
  } catch (err) { /* ignore */ }
  return '';
}

/**
 * メモリファイルに書き込む
 */
function writeMemory(workspacePath, name, content) {
  const memoryDir = path.join(workspacePath, 'memory');
  try {
    fs.mkdirSync(memoryDir, { recursive: true });
    const filePath = path.join(memoryDir, `${name}.md`);
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (err) { /* ignore */ }
}

/**
 * メモリインデックスと関連ファイルを読み込んでプロンプト用テキストを生成
 */
function loadMemoryForPrompt(workspacePath) {
  const memoryDir = path.join(workspacePath, 'memory');
  let result = '';

  // MEMORY.md を読む
  const index = readMemory(workspacePath);
  if (!index) return '';

  result += index + '\n\n';

  // インデックスからリンクされたファイルを読む
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(index)) !== null) {
    const fileName = match[2];
    const filePath = path.join(memoryDir, fileName);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        result += `--- ${fileName} ---\n${content}\n\n`;
      }
    } catch (err) { /* ignore */ }
  }

  return result.trim();
}

module.exports = { readMemory, writeMemory, loadMemoryForPrompt };
