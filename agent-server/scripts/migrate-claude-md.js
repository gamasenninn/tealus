/**
 * 既存 workspace の CLAUDE.md に「## 共有メモリ」section を追加する migration script
 *
 * 起点: tealus#236 Option 1 (Deep agent が Light の memory を参照可能にする)
 *
 * Idempotent: `@memory/MEMORY.md` の参照が既にあれば skip。
 * 何度実行しても安全。
 *
 * 使い方:
 *   node scripts/migrate-claude-md.js --dry-run   # 事前確認 (書き込みなし)
 *   node scripts/migrate-claude-md.js              # 実行
 *
 * 環境変数:
 *   AGENT_WORKSPACE_ROOT — workspace の root path (default: ../agent-workspaces 相対)
 */
const fs = require('fs');
const path = require('path');

const SHARED_MEMORY_SECTION = `
## 共有メモリ

過去の会話で蓄積した記憶や user 情報は @memory/MEMORY.md を参照してください。
このファイルは Light agent が能動的に書き、Deep agent (本 session) からは読み取りで参照します。
`;

const DRY_RUN = process.argv.includes('--dry-run');
const WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT
  || path.join(__dirname, '..', 'agent-workspaces');

function migrateAll() {
  const root = path.resolve(WORKSPACE_ROOT);
  if (!fs.existsSync(root)) {
    console.log(`Workspace root not found: ${root}`);
    return;
  }

  console.log(`Scanning: ${root}${DRY_RUN ? ' (dry-run)' : ''}\n`);

  let scanned = 0, updated = 0, skipped = 0, errored = 0;
  for (const agentId of fs.readdirSync(root)) {
    const agentDir = path.join(root, agentId);
    let agentStat;
    try {
      agentStat = fs.statSync(agentDir);
    } catch {
      continue;
    }
    if (!agentStat.isDirectory()) continue;

    for (const roomId of fs.readdirSync(agentDir)) {
      const roomDir = path.join(agentDir, roomId);
      try {
        if (!fs.statSync(roomDir).isDirectory()) continue;
      } catch {
        continue;
      }
      const claudeMdPath = path.join(roomDir, 'CLAUDE.md');
      if (!fs.existsSync(claudeMdPath)) continue;
      scanned++;

      try {
        const content = fs.readFileSync(claudeMdPath, 'utf8');
        // idempotent: @memory/MEMORY.md の参照が既にあれば skip
        if (content.includes('@memory/MEMORY.md')) {
          skipped++;
          console.log(`[skip] already migrated: ${agentId}/${roomId}`);
          continue;
        }

        const newContent = content.trimEnd() + '\n' + SHARED_MEMORY_SECTION;
        if (DRY_RUN) {
          console.log(`[dry-run] would update: ${agentId}/${roomId}`);
        } else {
          fs.writeFileSync(claudeMdPath, newContent, 'utf8');
          console.log(`[updated] ${agentId}/${roomId}`);
        }
        updated++;
      } catch (err) {
        errored++;
        console.error(`[error] ${agentId}/${roomId}: ${err.message}`);
      }
    }
  }

  console.log(`\nSummary: scanned=${scanned}, updated=${updated}, skipped=${skipped}, errored=${errored}${DRY_RUN ? ' (dry-run)' : ''}`);
}

migrateAll();
