/**
 * `@cc-` の宛名の読み取り (純関数だけ。import を持たない)。
 *
 * ★ 改善ループ 108 (2026-11-25): 本体 (server/src/services/cc/ccAddress.mts) と
 *   agent-server (agent-server/src/webhook/ccAddress.mts) に**同じ中身**で置く。
 *   どちらが受け付けるかは `CC_INTAKE` で決まるので、片方だけ直すと設定 1 つで配り先が変わる。
 *   包みをまたぐ import はしない約束なので写しにして、
 *   server/__tests__/unit/ccAddressSameInBothPackages.test.mts が 1 文字単位で突き合わせる。
 *   ★ 直すときは両方を同じに直すこと。
 *
 * 別名 (cc-aliases.json) を使う解決 (extractCcProject / extractCcProjects) は各包みの ccQueue.mts に残す
 * (設定の置き場所が包みごとに違うため)。
 */

// `@cc-{project}` mention 検出 (#215 先頭マッチング方式)。
// - **メッセージ (or 行) の先頭** に @cc-{project} がある場合のみ match。
//   /m flag で multi-line 対応 (改行直後も「先頭」扱い)
// - project 名: 英小文字 / 数字 / ハイフン (lowercase 規約)
// - 複数 mention は最初の 1 つを返す
// - 自己ループ防止の主要メカニズム: AI reply は本文中 (先頭ではない位置) で
//   @cc-* を引用するため、自然に skip される (CC_SKIP_SENDER_IDS は defense in depth)
const CC_MENTION_RE = /^@cc-([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)/m;

/**
 * #387 同報の上限。1 便がこれ以上のセッションを起こすことはない。
 * 実測 (cc-queue 全 1323 便) の最大は 3 宛先なので、通常運用では当たらない。
 * **暴走したときに止まる高さ**として置いている。
 */
const CC_FANOUT_MAX = 5;

// 宛名欄の中の 1 語。規約どおりの `@cc-名前` = 宛先。
const CC_ADDRESS_TOKEN_RE = /^@cc-([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/;
// 宛名欄の中の 1 語。`@cc-` **以外**の mention (`@アシスタント` / `@小野哲`) = 並びを途切れさせない。
// ★ `@cc-` で始まるのに規約外 (`@cc-Tealus` / `@cc-`) はここに落ちない = そこで打ち切る。
const OTHER_MENTION_TOKEN_RE = /^@(?!cc-)[^\s@]+$/;
// 行頭 (どの行でもよい) の mention を全部拾う。#386 の「捨てた宛先」検出に使う
const CC_MENTION_LINE_HEAD_G_RE = /^@cc-([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)/gm;

/** 最初の非空行。無ければ空文字 */
function firstNonEmptyLine(content: string): string {
  // ★ #541 Windows の改行 (CRLF) も行の区切りにする。'\n' だけで切ると行末に '\r' が残り、
  //   最後の宛先が宛先と読めずに黙って落ちた (`@アシスタント @cc-x` では 1 件も届かなかった)
  return content.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
}

/**
 * 宛名欄の中の `@cc-名前` を出現順・重複排除で返す (#393)。**封筒の宛名欄**の考え方:
 *
 * ```
 *   宛名欄 = 最初の非空行の 行頭から 連続する mention の並び
 *   その並びの中の @cc-名前 が宛先 (連名可)
 *   ★ mention でない語が来たら そこで終わり。本文に出てくる名前は宛名ではない
 * ```
 *
 * ★ #387 までは「並びは `@cc-` だけ」だった。`@アシスタント @cc-phronesis 返信ください` が
 *   **配送も warn も hint も出ずに落ちていた** (2026-08-25 実測)。3 つの検査すべてが
 *   行頭を見ていたため、宛名を 1 つ前にずらすだけで全部すり抜ける。
 *
 * ★★ **緩められるのはここまで**。自己ループ防止の主要機構がこの限定だから (docs/06 §6.1)。
 *   2026-09-03 に全期間 (`@cc-` を含む 1747 便) で測った:
 * ```
 *   どこでもよい          新規 201 便 → ★ うち 134 便が Claude 自身の引用。採れない
 *   第 1 非空行のどこでも   新規   9 便 → ★ 8 便が誤報 (89%)。「@cc-organon 起動」等
 *   ★ この規則            新規   1 便 → ★★★ 誤報 0 件。それが当該メッセージ
 * ```
 *
 * ★★★ **先行 whitespace は従来どおり不可**。「行頭であること」は緩めていない。
 *   緩めたのは「並びの先頭が `@cc-` であること」だけ。
 */
function addressRunCcNames(content: string): string[] {
  const line = firstNonEmptyLine(content);
  if (!line.startsWith('@')) return [];
  const names: string[] = [];
  for (const token of line.split(/[ \t]+/)) {
    const cc = CC_ADDRESS_TOKEN_RE.exec(token);
    if (cc) { names.push(cc[1]); continue; }
    if (OTHER_MENTION_TOKEN_RE.test(token)) continue;
    break;
  }
  return [...new Set(names)];
}

/**
 * 行頭に書かれているのに配送しなかった宛先を返す (#386 黙って捨てない)。
 *
 * 対象は **行頭の `@cc-`** だけ。本文中の引用 (`宛先は @cc-organon と書く`) では鳴らさない
 * —— AI 同士が宛先を説明するたびに鳴ると、警告が通常の会話に埋もれて「見えない」に戻る
 * ([[detectUnroutedAddressHint]] と同じ stance)。
 *
 * ★ 上限超過分もここに現れる: `delivered` が CC_FANOUT_MAX で切られているため、
 *   1 行目に並んだ 6 番目以降が差分として出る。
 *
 * @param delivered 実際に配送した project 名 (extractCcProjects の結果)
 */
function findDroppedCcMentions(content: string | null | undefined, delivered: readonly string[]): string[] {
  if (typeof content !== 'string' || content.length === 0) return [];
  const deliveredSet = new Set(delivered);
  CC_MENTION_LINE_HEAD_G_RE.lastIndex = 0;
  const lineHead = [...content.matchAll(CC_MENTION_LINE_HEAD_G_RE)].map((m) => m[1]);
  // 宛名欄に並べた分は行頭 1 つ分しか掛からないので、そちらも合わせて見る。
  // ★ #393 以降、宛名欄は行頭に無いことがある (`@アシスタント @cc-a @cc-b`)。
  //   ここを揃えないと、上限で切られた 6 番目以降が**黙って消える**
  const candidates = new Set([...lineHead, ...addressRunCcNames(content)]);
  return [...candidates].filter((n) => !deliveredSet.has(n));
}

// #359 (a) 宛先を書いたつもりで配送されなかった便を拾うための signal。
// 社内の宛先記法「【organon班 → 本体班】」= 矢印のあとに 班。2026-08-20 の実害はこの形。
const TEAM_ARROW_RE = /→\s*\S*班/;
// 行頭の `@cc-` 記法を試したが CC_MENTION_RE に届かなかったもの (`@cc-Tealus` / `@cc-` 等)。
const CC_MENTION_ATTEMPT_RE = /^@cc-/m;
// #450 宛名の前に付いた **強調** と空白。剥がした先が `@cc-` なら「書こうとした」と読む。
// ★ `` ` `` と `>` は **入れない**。code span と引用は「説明している / 引用している」便で、
//   そこで鳴らすと雑音に埋もれて「見えない」に戻る (下の [[detectUnroutedAddressHint]] 参照)。
const ADDRESS_DECORATION_RE = /^[\s*_~]+/;

/** #359 (a) の判定結果。null = 宛先を書いたようには見えない。 */
type UnroutedAddressHint = 'team-arrow' | 'malformed-cc-mention' | 'decorated-address' | null;

/**
 * 配送されなかった便のうち「宛先を書いたつもり」に見えるものを判別する (#359 (a))。
 *
 * 2026-08-20 の実害: `【organon班 → 本体班】🔴 6 件目…` が 3 日間どの queue にも入らず、
 * **送信側にも受信側にも痕跡が残らなかった**。issue の選択肢 6「silent をやめる」の実装。
 *
 * ★ 精度を優先する。配送されなかった便を全部 info に上げると、通常の会話で埋もれて
 *   「見えない」に戻る。**鳴らない方に倒し、鳴ったら本物**を狙う:
 * - 見るのは **最初の非空行だけ** — 長い返信が後段で他班のやり取りを引用しても鳴らない
 * - 本文中 (行頭でない) の `@cc-` 引用では鳴らさない — AI 同士が宛先を説明するたびに鳴るため
 *
 * ★★★★ #450 `decorated-address` — 宛名を `**@cc-x**` と強調で囲う / 前に空白を置く形。
 *   2026-09-21 に 3 通が不着になった。**投稿は 200 で成功し部屋にも残る**ので送り手も
 *   受け手も気づけず、3 通ともログに 1 行も出ていなかった。直近 60 日 (`@cc-` を含む
 *   2245 便) で測ると:
 * ```
 *   本文のどこかに @cc-   229 便 → ★ ほぼ AI 自身の署名 (`📋 Day73 Q0…`)。採れない
 *   ★ 飾りを剥がして行頭    3 便 → ★★★ 3 件とも実害。誤報 0
 * ```
 *   ★★ 剥がすのは 空白と `* _ ~` **だけ**。`` ` `` と `>` を入れると
 *   「`` `@cc-organon` を先頭に置く ``」のような **説明・引用の便で鳴る**。
 *
 * ★ 呼び出し側は extractCcProject() が null のときだけ呼ぶこと。routing 済みの便に
 *   対して呼んでも null を返すが (下の `!CC_MENTION_RE.test`)、意味のある使い方ではない。
 */
function detectUnroutedAddressHint(content: string | null | undefined): UnroutedAddressHint {
  if (typeof content !== 'string' || content.length === 0) return null;
  const firstLine = content.split(/\r?\n/).find((l) => l.trim().length > 0);   // ★ #541 CRLF も
  if (!firstLine) return null;
  // 規約どおりに match するなら routing 済み = ここでは扱わない
  // ★ 宛名欄も見る (#393)。配送されるようになった便で hint を鳴らすと、
  //   「届かなかった」の合図が「届いた」便に付く = 読み手が逆に読む
  if (addressRunCcNames(content).length > 0) return null;
  if (CC_MENTION_RE.test(content)) return null;
  if (CC_MENTION_ATTEMPT_RE.test(firstLine)) return 'malformed-cc-mention';
  // #450 宛名を **強調**や先行空白で潰した便。★ 剥がしてから見るのは 1 行目だけ
  if (CC_MENTION_ATTEMPT_RE.test(firstLine.replace(ADDRESS_DECORATION_RE, ''))) return 'decorated-address';
  if (TEAM_ARROW_RE.test(firstLine)) return 'team-arrow';
  return null;
}

export type { UnroutedAddressHint };

export {
  CC_MENTION_RE,
  CC_FANOUT_MAX,
  addressRunCcNames,
  findDroppedCcMentions,
  detectUnroutedAddressHint,
};
