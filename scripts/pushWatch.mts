/**
 * push して、**その push の CI が終わるまで見る** (2026-09-24)。
 *
 * ★★★★★ なぜ要るか: 2026-09-24 に 5 本 続けて push し、★ **5 本とも赤**だった。
 *   ★★ 気づいたのは 5 時間後、別の用事で `npm run doctor` を引いたとき。
 *   ★★★ `ci-status` の口は 2026-09-19 に「14 日 赤に気づかなかった」から作られたが、
 *      **1 日 1 回 doctor を引いたときしか鳴らない**。push 直後には鳴らない。
 *   ★★★★ 「push したら見る」を **約束でなく手順**にする。
 *
 * ★ `gh run watch` に任せきりにしない —— ★★ 引数なしだと **最新の run** を見るので、
 *   push 直後にまだ run が登録されていないと **1 つ前の (完了済みの) run** を見て
 *   すぐ成功と出る。★★★ だから **HEAD の sha と一致する run** を待ってから見る。
 *
 * 使い方: npm run push            (= git push のあと CI を見る)
 *        npm run push -- --dry   (★ push せず、いまの HEAD の CI だけ見る)
 */
import { execFileSync, execFile } from 'node:child_process';

const DRY = process.argv.includes('--dry');
const sh = (cmd: string, args: string[]): string =>
  execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true }).trim();

if (!DRY) {
  console.log('★ git push');
  console.log(sh('git', ['push']));
}

const sha = sh('git', ['rev-parse', 'HEAD']);
console.log(`★★ HEAD ${sha.slice(0, 7)} の CI を待ちます`);

interface Run { databaseId: number; headSha: string; status: string; conclusion: string | null }
const listRuns = (): Run[] => {
  try {
    return JSON.parse(sh('gh', ['run', 'list', '--limit', '10', '--json', 'databaseId,headSha,status,conclusion'])) as Run[];
  } catch {
    return [];          // ★ 引けないことを「成功」にしない。下で待ち続ける
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ★ run が登録されるのを待つ (最大 3 分)。★★ 出てこなければ **黙って成功にしない**
let run: Run | undefined;
for (let i = 0; i < 36 && !run; i++) {
  run = listRuns().find((r) => r.headSha === sha);
  if (!run) await sleep(5000);
}
if (!run) {
  console.error('★★★★ この sha の CI が 3 分たっても現れません。★ 自分で見てください:');
  console.error('  gh run list --limit 5');
  process.exit(2);
}

console.log(`★ run ${run.databaseId} を見ます`);
const code = await new Promise<number>((resolve) => {
  const child = execFile('gh', ['run', 'watch', String(run!.databaseId), '--exit-status'],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, () => { /* 出力は下の stdio で流す */ });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  child.on('close', (c) => resolve(c ?? 1));
});

if (code === 0) {
  console.log('★★★★ CI 成功');
} else {
  console.error('★★★★★ CI が赤いです。★ 失敗した step を出します:');
  try {
    console.error(sh('gh', ['run', 'view', String(run.databaseId), '--log-failed']).slice(-4000));
  } catch {
    console.error(`  gh run view ${run.databaseId} --log-failed`);
  }
}
process.exit(code);
