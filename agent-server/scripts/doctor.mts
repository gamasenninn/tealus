/**
 * #438 / #442 doctor の手動の口。★ `npm run doctor` / `npm run doctor -- --probe`
 *
 * ★ 起動時の 1 行と同じ判定を、人が確かめたいときに叩ける形にする。
 * ★★ **既定では外部を叩かない** (#442)。叩くのは `--probe` を付けたときだけで、
 *   叩かなかった経路は `not-probed` と出る (= ★★★ 「確かめて全部だめ」と区別が付く)。
 * ★★★ 値は 1 文字も出さない (指紋のみ)。結果を外部へ送らない。
 *
 * ★★★★ **例外が 1 つある: `ci-status` は既定でも `gh` を叩く** (2026-09-19 に追加)。
 *   ★ 契約を曲げた理由: CI が 14 日 / 51 回 赤のまま誰も気づかなかった。
 *     `--probe` の側に置くと **日々の口に出ない** = 直したいこと (誰も見ない) がそのまま残る。
 *   ★★ 送るものは無い (自分のリポジトリの実行結果を読むだけ)。引けなければ `info` にし、
 *     **「成功」とは書かない** (= 壊れた値は沈黙より悪い)。
 */
import dotenv from 'dotenv';
import { runDoctor, runDeepChecks, formatFindings, type Finding } from '../src/lib/doctor.mts';
// ★ DB / 外部を掴む側は別 module。★★ ここでだけ import する (起動時には載らない)。
import { runDbChecks, runProbeChecks } from '../src/lib/doctorDeep.mts';
// ★ ci-status は **既定で走る唯一の「読みに行く」口**。理由は下の注記。
import { judgeCiStatus, fetchCiRuns } from '../src/lib/doctorCi.mts';

dotenv.config();

const probe = process.argv.includes('--probe');

const findings: Finding[] = [
  ...runDoctor(process.env),
  ...runDeepChecks(process.env),
  ...(await runDbChecks(process.env)),
  judgeCiStatus(await fetchCiRuns(), new Date()),
  ...(probe ? await runProbeChecks(process.env) : []),
];

console.log(formatFindings(findings));
if (!probe) {
  // ★ 叩かなかったことを黙らない。★★ 沈黙は「叩いて何も出なかった」と読まれる。
  console.log('[doctor:info] external-reachability\n  ★ この実行では外部を 1 回も叩いていません\n  → `npm run doctor -- --probe` で実測します (★ 一覧を引くだけなのでトークンは消費しません)');
}
// ★ 止めない。warn があっても exit 0 (= 起動を妨げない、という約束と揃える)。
//   ★★ CI から使いたくなったら --strict のような別の口を足す (既定は変えない)。
