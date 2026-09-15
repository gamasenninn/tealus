/**
 * #440 手直しの台帳 — 人が直した対を頻度順に出す (★ 読み取りのみ)。
 *
 * ## なぜ要るか
 *
 * 2026-09-14 に測ったところ、通話履歴は 30 日で 868 件入り **539 件 (62%) を人が手で
 * 直していた** (訂正 1,002 回 / 3 人)。全ルームの `message_edits` の 97% がこのルーム。
 * **製品の中でいちばん人の時間を使っている場所**だが、材料は DB に入っていて誰も読んでいない。
 *
 * ★ 自己成長辞書 (`aliasMiner` / `dictionaryLearner`) は `voice_transcriptions` しか
 *   読まない。**通話履歴の訂正はそこに入らない** (file メッセージで、文字起こしを
 *   通っていない = 30 日 874 件中 0 件)。この台帳が見ているのは、学習器に見えていない側。
 *
 * ★★ ただし **語を足す提案はしない**。「語を足すのは無料ではない」実測がある
 *   (213 語に 7 語足して正解が 6 → 5)。ここは **数えるだけ**で、足すかどうかは別の判断。
 *
 * ## 差分の取り方
 *
 * `aliasMiner.extractAliasPairs` をそのまま使う (★ 決定論・LLM 不要・テスト済み)。
 * 人間版の中の既知 term に錨を打って旧版の対応スパンを読む形なので、
 * 「崩れと正解が文字を共有すると差分が収縮する」char-LCS の盲点を構造的に避けている。
 *
 * 使い方:
 *   ORGANON_TTL_PATH は不要。DB だけ見る。
 *   node scripts/correctionLedger.mts [--days 14] [--room 通話履歴] [--top 20]
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { pool } from '../src/db/pool.mts';
import { extractAliasPairs } from '../src/services/aliasMiner.mts';
import { projectOrganonDict, collectConfirmedSurfaces } from './organonDictProjection.mts';

dotenv.config();

/** 訂正 1 件の分類。★ organon 班と合意した 3 値 + 「canon 外」。 */
export type CorrectionKind = 'garble' | 'normalize' | 'unknown' | 'outside';

/**
 * 訂正対を分類する。★ 純関数。
 *
 * ★ `unknown` を独立させる理由: 「後段が作った誤り」は **raw が無いと決められない**。
 *   前が canon にある = 後段が canon の語に化けさせた疑いはあるが、STT が自力でその語を
 *   出した可能性を排除できない。**「まだ分からない」を「崩れ」に混ぜない。**
 * ★★ `normalize` を分ける理由: 前も後も canon の表層なら、人が好みの表記に寄せただけで
 *   誤りではない (漢字の社名 → カタカナ)。混ぜると上位が汚れる。
 */
export function classifyPair(
  pair: { from: string; to: string },
  canonSurfaces: Set<string>,
): CorrectionKind | null {
  const from = (pair.from || '').trim();
  const to = (pair.to || '').trim();
  if (!from || !to || from === to) return null;
  const fromCanon = canonSurfaces.has(from);
  const toCanon = canonSurfaces.has(to);
  if (fromCanon && toCanon) return 'normalize';
  if (fromCanon) return 'unknown';
  if (toCanon) return 'garble';
  return 'outside';
}

/**
 * 共通の前後を落として、変わった部分だけを返す。
 *
 * ★ なぜ要るか (2026-09-14 実測): `extractAliasPairs` が使う LCS は 400 字を超える入力で
 *   null を返す (O(n·m) の dp を張るため)。通話履歴の編集本文は **平均 1,584 字で、
 *   669 件中 648 件 (97%) が 400 字超**。決定論抽出器は、この母集団のほぼ全部を
 *   **黙って捨てていた** —— 台帳を通したら 369 組から訂正が 3 件しか出ず、別手段の
 *   実測 (663 件) と桁が違って気づいた。
 *
 * ★★ 直しは「上限を上げる」ではなく **「渡す量を減らす」**。訂正の 78% は 1〜3 文字なので、
 *   共通の前後を落とせば窓は小さくなる。上限を上げると 3,700 字 × 3,700 字の dp を張ることになる。
 *
 * ★★★ 前後に文脈を残すのは、抽出器が「○○さん」の "さん" を右アンカーに使うため。
 *   削ると錨を失い、崩れの範囲を読み違える。
 */
export function trimToChangedWindow(
  oldText: string,
  newText: string,
  context: number,
): { old: string; neu: string } {
  const a = oldText || '';
  const b = newText || '';
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  if (head === a.length && head === b.length) return { old: '', neu: '' };
  const from = Math.max(0, head - context);
  return {
    old: a.slice(from, a.length - tail + context),
    neu: b.slice(from, b.length - tail + context),
  };
}

/**
 * ★ 2026-09-15 — raw が揃ったので `unknown` を実際に判定できるようになった。
 *
 * ★★ 鍵は本文にある: 通話履歴の本文 1 行目が `【通話】sum_<vid> / ...` で、
 *   raw は `raw_<vid>.txt`。**新しい対応表を作らない。**
 */
export function extractVid(content: string): string | null {
  const m = /sum_(\d+)/.exec(content || '');
  return m ? m[1] : null;
}

/** 訂正前の語が STT の生出力に在ったか。★ 3 値 —— 「raw が無い」を「崩れ」に倒さない。 */
export type RawVerdict = 'stt' | 'stage' | 'no-raw';

/**
 * 訂正前の語が raw に在るかで、崩れの出所を決める。★ 純関数。
 *
 * ```
 * ★ raw に在る   → STT が出した     (= 崩れ ①)
 * ★ raw に無い   → 後段が作った     (= 誤り ②)   ★★ 補正段が実在の語に化けさせた形
 * ★★★ raw が無い → 決めない
 * ```
 * ★ raw は 2026-09-14 12:57:52 から。それ以前の便には無いので `no-raw` が普通に出る。
 *   **件数を必ず出すこと** —— 黙ると「②が 0 件」に読める。
 */
export function judgeByRaw(from: string, rawText: string | null): RawVerdict {
  if (!from || rawText === null) return 'no-raw';
  return rawText.includes(from) ? 'stt' : 'stage';
}

/** text 中の word の出現数。★ 重なりは数えない (indexOf を語長で進める)。 */
function countOccurrences(text: string, word: string): number {
  if (!word) return 0;
  let n = 0;
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + word.length)) n += 1;
  return n;
}

export interface RateRow {
  word: string;
  /** 本来出るべき回数 = 最終版 (人が直したあと) の出現数 */
  expected: number;
  /** 機械が出せた回数 = 最古の版 (機械の出力) の出現数。★ 本来を超える分は切る */
  produced: number;
  garbled: number;
  rate: number;
}

/**
 * 語ごとに「本来 / 出せた / 崩れ」と率を出す。★ 純関数。
 *
 * ★ なぜ件数ではなく率か (2026-09-14 の実測で判明)
 *   崩れの件数だけで並べると順位が誤る。同じ日に実際に踏んだ:
 *     `鹿沼`  101 箇所中 53 崩れ = 52.5% / `宇都宮` 97 箇所中 4 崩れ = 4.1%
 *   件数の 53 と 4 で「13 倍ひどい」と読めたのは **出現数がほぼ同じだったから**で、
 *   偶然に助けられている。出現 5 回で 5 回とも崩れる語は、件数では下位に沈む。
 *   ★ 台帳の目的は「上から潰す」なので、順位が誤ると潰す相手を間違える。
 *
 * ★★ 分母は **最終版の出現数**。機械が正しく出した回は人が触らないので、
 *   無編集の通話も分母に入る (= 母集団の一部)。
 *
 * ★★★ 最終版に 1 度も出ない語は **行を作らない**。率が定義できないのに 0% と書くと
 *   「完璧に出せている」に読める —— 2026-09-14 の `真岡` (30 日で最終版に 0 回) がそれ。
 */
export function buildRateRows(
  words: string[],
  docs: Array<{ final: string; orig: string }>,
): RateRow[] {
  const out: RateRow[] = [];
  for (const word of words) {
    let expected = 0;
    let produced = 0;
    for (const d of docs) {
      const e = countOccurrences(d.final, word);
      if (!e) continue;
      expected += e;
      // ★ 機械が余分に出した回 (誤産出) で崩れを負にしない。負を足すと、他の通話の
      //   崩れが相殺されて母集団全体が過小になる。
      produced += Math.min(countOccurrences(d.orig, word), e);
    }
    if (!expected) continue;
    const garbled = expected - produced;
    out.push({
      word,
      expected,
      produced,
      garbled,
      rate: Math.round((1000 * garbled) / expected) / 10,
    });
  }
  return out;
}

const LABEL: Record<CorrectionKind, string> = {
  garble: '崩れ (canon の語へ直された)',
  normalize: '表記の寄せ (どちらも canon = 誤りではない)',
  unknown: '不明 (前が canon。後段が作った疑いだが raw が無いと決められない)',
  // ★ この値は現在の抽出器では出ない。`extractAliasPairs` は **新しい方の文に居る canon 語**に
  //   錨を打って旧側を読むので、`to` は定義上いつも canon になる。
  //   → 「canon に無い語への訂正」(= 語を足す候補) を見たければ **別の抽出器**が要る。
  //   分類の値としては残す。0 件が「そういう訂正が無い」ではなく「見えていない」ことを示すため。
  outside: 'canon 外 (★ 現在の抽出器では検出できない。0 は「無い」ではなく「見えていない」)',
};

/**
 * ★ canon の参照先は **経路に合わせる**。ここを取り違えると 0 件に見える。
 *
 * 2026-09-14 実測: 通話履歴を「辞書テーブル」の canon で見たら、`神山 → 鹿沼` (14 日で
 * 17 行) が 1 件も出なかった。原因は参照先の違いで、**裸の `鹿沼` は辞書テーブルに無い**
 * (あるのは 鹿沼店 / 鹿沼商工会 等の複合語だけ)。一方 `神山` は person として在る。
 *
 *   通話履歴 (別リポ)  organon.ttl を直読み   → 鹿沼 は在る
 *   朝礼 / 補正段      辞書テーブル (射影)    → 鹿沼 は無い (Location は射影されない)
 *
 * → 通話履歴の訂正を辞書テーブルの canon で見るのは、**別の経路のものさしを当てている**。
 */
async function loadCanonSurfaces(): Promise<Set<string>> {
  const { rows } = await pool.query<{ s: string }>(
    `SELECT term AS s FROM dictionary_terms WHERE status = 'active'
     UNION
     SELECT a.alias AS s FROM dictionary_aliases a
       JOIN dictionary_terms t ON t.id = a.term_id
      WHERE a.status = 'active' AND t.status = 'active'`,
  );
  return new Set(rows.map((r) => r.s).filter(Boolean));
}

/**
 * 同じ message の版を (旧, 新) で並べる。★ 純関数。
 *
 * ★★★★ **最後の遷移を落とさないこと。** `message_edits` が持つのは **過去の版**で、
 *   **最終版は `messages.content`** にある。版の間だけを組むと、
 *   **人が受け入れた最後の訂正が丸ごと落ちる**。
 *
 * ★ 実測 (通話履歴 / 直近 14 日、2026-09-15):
 * ```
 * 編集のあったメッセージ 310 件 / edit 行 702 行
 * ★ 版の間だけ        392 組
 * ★★★★ 落ちていた分   310 組 (44%)。うち 1 回だけ編集の 127 件は **対が 0 件**
 * ★★ 310 件すべてで 最後の edit 行 ≠ messages.content (= 最後の遷移は実在する)
 * ```
 * ★★ 最終版が引けないメッセージには最後の遷移を作らない (★ 推測しない)。
 */
export function pairVersions(
  rows: Array<{ message_id: string; version: number; content: string }>,
  finals: Map<string, string>,
): Array<{ old: string; neu: string }> {
  const out: Array<{ old: string; neu: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    const next = rows[i + 1];
    if (next && next.message_id === cur.message_id) {
      out.push({ old: cur.content, neu: next.content });
      continue;
    }
    // ★ このメッセージの最後の版 → 最終版
    const fin = finals.get(cur.message_id);
    if (fin !== undefined && fin !== cur.content) out.push({ old: cur.content, neu: fin });
  }
  return out;
}

async function loadEditPairs(room: string, days: number): Promise<Array<{ old: string; neu: string }>> {
  const { rows } = await pool.query<{ message_id: string; version: number; content: string }>(
    `SELECT e.message_id, e.version, e.content
       FROM message_edits e
       JOIN messages m ON m.id = e.message_id
       JOIN rooms r ON r.id = m.room_id
      WHERE r.name = $1 AND e.created_at > now() - ($2 || ' days')::interval
      ORDER BY e.message_id, e.version`,
    [room, String(days)],
  );
  const { rows: finalRows } = await pool.query<{ id: string; content: string }>(
    `SELECT m.id, m.content
       FROM messages m JOIN rooms r ON r.id = m.room_id
      WHERE r.name = $1 AND m.is_deleted = false
        AND EXISTS (SELECT 1 FROM message_edits e
                     WHERE e.message_id = m.id
                       AND e.created_at > now() - ($2 || ' days')::interval)`,
    [room, String(days)],
  );
  return pairVersions(rows, new Map(finalRows.map((r) => [r.id, r.content])));
}

/**
 * 率の分母を取るための文書対。★ **編集されていない通話も含める** ——
 * 機械が正しく出した回は人が触らないので、そこを落とすと分母が「誤りのあった通話」だけになり、
 * 率が必ず高く出る (★ 2026-09-14 に踏んだ選択効果)。
 */
async function loadDocs(room: string, days: number): Promise<Array<{ final: string; orig: string }>> {
  const { rows } = await pool.query<{ final: string; orig: string }>(
    `SELECT m.content AS final,
            COALESCE((SELECT e.content FROM message_edits e
                       WHERE e.message_id = m.id ORDER BY e.version LIMIT 1), m.content) AS orig
       FROM messages m JOIN rooms r ON r.id = m.room_id
      WHERE r.name = $1 AND m.type = 'file' AND m.is_deleted = false
        AND m.created_at > now() - ($2 || ' days')::interval`,
    [room, String(days)],
  );
  return rows;
}

function argOf(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (import.meta.main) {
  const days = parseInt(argOf('days', '14'), 10);
  const room = argOf('room', '通話履歴');
  const top = parseInt(argOf('top', '20'), 10);
  const focus = argOf('focus', '');
  // ★ raw の置き場所。★★ 別リポ (SP2TXT) が書くので env / 引数で差し替えられる形にする。
  const rawDir = argOf('raw', process.env.TLS_RAW_DIR
    // ★ 区切りは `/` にする。Windows の Node はどちらでも開けるが、`\t` `\r` が
    //   エスケープとして解釈されて黙って別のパスになる (2026-09-15 に実際に踏んだ)。
    || 'C:/OneDrive/ドキュメント/PY_SRC/SP2TXT/temp/raw');

  (async () => {
    // ★ 既定は `ttl` = **通話履歴が実際に読んでいる形** (全 kind・confirmed のみ)。
    //   ★★ 2026-09-15 まで既定は `organon` (= 射影) だった。射影は Role / Organization しか
    //   残さないので、**Location の訂正が丸ごと「canon 外」に落ちていた**。
    //   実測: 射影の表層 867 / 全 kind 1,298。`鹿沼` `芝駐` `宇都宮` は射影に無い。
    //   ★★★ この区別は下の `loadCanonSurfaces` の doc に書いてあったのに、
    //   **実装が射影を選んでいた**。書いてあることと、していることが違っていた。
    const canonSrc = argOf('canon', 'ttl');
    let canon: Set<string>;
    if (canonSrc === 'dict') {
      canon = await loadCanonSurfaces();
    } else {
      const ttl = process.env.ORGANON_TTL_PATH;
      if (!ttl) throw new Error('ORGANON_TTL_PATH が要る (--canon dict なら不要)');
      const text = fs.readFileSync(ttl, 'utf8');
      if (canonSrc === 'ttl') {
        canon = collectConfirmedSurfaces(text);
      } else {
        // ★ `organon` = 射影。**朝礼 / 本体の補正段**を測るときはこちら
        canon = new Set<string>();
        for (const p of projectOrganonDict(text)) {
          canon.add(p.term);
          for (const a of p.aliases) canon.add(a);
        }
      }
    }
    const pairs = await loadEditPairs(room, days);
    const terms = [...canon];

    const counts = new Map<string, { from: string; to: string; kind: CorrectionKind; n: number }>();
    const byKind = new Map<CorrectionKind, number>();
    // ★ #440 の unknown 列。raw が揃ったので出所を決める (2026-09-15)。
    const byRaw = new Map<RawVerdict, number>();
    const stageMade: Array<{ from: string; to: string; vid: string }> = [];
    const rawCache = new Map<string, string | null>();
    const readRaw = (vid: string | null): string | null => {
      if (!vid) return null;
      if (!rawCache.has(vid)) {
        try {
          rawCache.set(vid, fs.readFileSync(path.join(rawDir, `raw_${vid}.txt`), 'utf8'));
        } catch {
          rawCache.set(vid, null); // ★ 無い = 決めない。0 件ではない
        }
      }
      return rawCache.get(vid) ?? null;
    };

    for (const p of pairs) {
      // ★ vid は本文 1 行目にある (【通話】sum_<vid>)。★★ 対応表を作らない。
      const raw = readRaw(extractVid(p.old));
      // ★ 長文をそのまま渡すと LCS の上限 (400 字) で黙って捨てられる。変わった窓だけ渡す。
      const w = trimToChangedWindow(p.old, p.neu, 60);
      if (!w.old && !w.neu) continue;
      for (const ex of extractAliasPairs(w.old, w.neu, terms)) {
        const kind = classifyPair(ex, canon);
        if (!kind) continue;
        const verdict = judgeByRaw(ex.from, raw);
        byRaw.set(verdict, (byRaw.get(verdict) || 0) + 1);
        if (verdict === 'stage') stageMade.push({ from: ex.from, to: ex.to, vid: extractVid(p.old) || '?' });
        // * 区切りは JSON にする (organonDictPrune と同じ形)。以前は NUL を区切りに使っていて、
        //   この file が grep に binary 判定され、検索で黙って飛ばされていた。
        const key = JSON.stringify([ex.from, ex.to]);
        const cur = counts.get(key) || { from: ex.from, to: ex.to, kind, n: 0 };
        cur.n += 1;
        counts.set(key, cur);
        byKind.set(kind, (byKind.get(kind) || 0) + 1);
      }
    }
    const all = [...counts.values()].sort((a, b) => b.n - a.n);
    const total = [...byKind.values()].reduce((a, b) => a + b, 0);

    // ★ 分母を必ず出す。「何便を対象にしたか」を書かない率は読めない (#435 の決めごと)。
    console.log(`ルーム ${room} / 直近 ${days} 日 / 版の対 ${pairs.length} 組 / canon=${canonSrc} 表層 ${canon.size}`);
    console.log(`訂正 延べ ${total} / 異なり ${all.length}`);
    for (const k of ['garble', 'unknown', 'normalize', 'outside'] as CorrectionKind[]) {
      const n = byKind.get(k) || 0;
      if (total) console.log(`  ${String(n).padStart(4)} (${Math.round((100 * n) / total)}%)  ${LABEL[k]}`);
    }

    // ★ #440 の unknown 列を raw で解く (2026-09-15)。★★ canon の分類とは独立の軸。
    //   ★★★ 分母を必ず出す —— raw は 2026-09-14 12:57 からしか無いので、
    //   「後段が作った 0 件」と「raw が無いから決めていない」を混ぜない。
    const nStt = byRaw.get('stt') || 0;
    const nStage = byRaw.get('stage') || 0;
    const nNoRaw = byRaw.get('no-raw') || 0;
    console.log(`\n--- 出所 (★ raw と突き合わせた。分母 ${nStt + nStage + nNoRaw}) ---`);
    console.log(`  ${String(nStt).padStart(4)}  ① 崩れ        (訂正前の語が raw に在った = STT が出した)`);
    console.log(`  ${String(nStage).padStart(4)}  ② 後段が作った (訂正前の語が raw に無い)`);
    console.log(`  ${String(nNoRaw).padStart(4)}  ★ 決めていない (raw が無い便。★★ 0 件ではない)`);
    console.log(`  ★ raw の置き場所: ${rawDir}`);
    if (stageMade.length) {
      console.log('  ★★ ② の内訳:');
      for (const s of stageMade.slice(0, 20)) console.log(`     ${s.from} → ${s.to}  (sum_${s.vid})`);
    }

    if (focus) {
      // ★ 特定の語が「枠を持つか」を見るための口 (organon 班への宿題)。
      const hits = all.filter((c) => c.to === focus || c.from === focus);
      console.log(`\n--- ${focus} に関わる訂正 ${hits.reduce((n, h) => n + h.n, 0)} 件 / ${hits.length} 通り ---`);
      for (const h of hits) console.log(`  ${h.from} → ${h.to}  ×${h.n}  [${h.kind}]`);
    } else {
      console.log(`\n--- 上位 ${top} (★ 崩れのみ。表記の寄せ・不明は除く) ---`);
      for (const c of all.filter((x) => x.kind === 'garble').slice(0, top)) {
        console.log(`  ${c.from} → ${c.to}  ×${c.n}`);
      }

      // ★ 件数の順位は「出現数がほぼ同じ」ときしか読めない。率を必ず併記する。
      //   2026-09-14 に、件数 53 vs 4 を「13 倍ひどい」と読んだ。出現数が偶然ほぼ同じ
      //   (101 vs 97) だったので結果的に合っていたが、根拠になっていなかった。
      const targets = [...new Set(all.filter((x) => x.kind === 'garble').map((x) => x.to))];
      const docs = await loadDocs(room, days);
      const rates = buildRateRows(targets, docs).sort((a, b) => b.rate - a.rate);
      console.log('\n--- 語ごとの崩れ率 (★ 分母 = 最終版の出現数。★★ 無編集の通話も含む) ---');
      console.log(`  ${'語'.padEnd(12)}本来  出せた  崩れ      率`);
      for (const r of rates) {
        console.log(
          `  ${r.word.padEnd(12)}${String(r.expected).padStart(4)}${String(r.produced).padStart(8)}` +
          `${String(r.garbled).padStart(6)}${String(r.rate).padStart(7)}%`,
        );
      }
      console.log('  ★ 最終版に 1 度も出ない語は行を作らない (★★ 率が定義できないため)');
      // ★ 入れ子の語は二重に数える (「飛行船」の出現数は「飛行船アグリ」の分を含む)。
      //   率どうしの比較には効かないが、★★ 合計を足し上げると 1 を超える。黙らせない。
      console.log('  ★ 入れ子の語は二重に数える (例: 「飛行船」は「飛行船アグリ」の分を含む)');
    }
    await pool.end();
  })().catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
}
