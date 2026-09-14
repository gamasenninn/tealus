/**
 * #438 doctor の手動の口。★ `npm run doctor`
 *
 * ★ 起動時の 1 行と同じ判定を、人が確かめたいときに叩ける形にする。
 * ★★ この版は **外部を叩かない**。実測が要るものは別の口に分ける (#438「2 段にする」)。
 * ★★★ 値は 1 文字も出さない (指紋のみ)。結果を外部へ送らない。
 */
import dotenv from 'dotenv';
import { runDoctor, runDeepChecks, formatFindings } from '../src/lib/doctor.mts';

dotenv.config();
// ★ 起動時と同じ判定 + 手動の口だけで走らせる分 (workspace 走査)。
console.log(formatFindings([...runDoctor(process.env), ...runDeepChecks(process.env)]));
// ★ 止めない。warn があっても exit 0 (= 起動を妨げない、という約束と揃える)。
//   ★★ CI から使いたくなったら --strict のような別の口を足す (既定は変えない)。
