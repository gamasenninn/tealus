/**
 * .env に OPENAI_API_KEY の行が無くても本体が起動する (2026-10-29 改善ループ 24 回目)
 *
 * ★ 文字起こし・整形が import した瞬間に OpenAI の部品を作り、鍵が undefined だと SDK が英語の例外で投げて
 *   本体が起動しなかった (空文字の行があれば起動する)。.env.example は「無ければ音声の文字起こしが止まるだけ」と書いている。
 *   起動時の検査 (runStartupEnvCheck) より先に import で落ちるので、検査の文も出なかった
 * ★ jest は動的 import を扱えないので、本番と同じ読み方 (node の型剥がし) で別プロセスに読ませる
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('★ 鍵が未定義でも、文字起こしと整形を import できる', () => {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  const r = spawnSync(process.execPath, ['-e',
    "Promise.all([import('./src/services/transcription.mts'), import('./src/services/formatting.mts')])"
    + ".then(() => { console.log('IMPORT_OK'); process.exit(0); }, (e) => { console.log('IMPORT_FAIL ' + e.message); process.exit(1); })"],
  { cwd: path.join(import.meta.dirname, '..', '..'), env, encoding: 'utf8', timeout: 60_000 });
  expect(r.stdout).toContain('IMPORT_OK');
});
