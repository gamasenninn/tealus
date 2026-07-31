/**
 * #354 🤖 パネルの判断規則 (純関数)。
 *
 * 「開くか / 直挿入か」「`/` で開くか」「どう差し込むか」の 3 つは仕様の核なので、
 * MessageInput の配線から切り離してここに置く。
 */

/**
 * 🤖 を押したときにパネルを開くか。
 *
 * 選ぶものが無い (履歴 0 件かつ宛先 1 つ) なら開かず、従来どおり 1 タップで
 * `@アシスタント ` を即挿入する。使い込んで履歴が溜まるとパネルが現れる形にして、
 * 初見のユーザーに選択肢を突きつけない。
 */
export function shouldOpenAgentPanel({ historyCount, targetCount }: { historyCount: number; targetCount: number }): boolean {
  if (targetCount === 0) return false;
  return historyCount > 0 || targetCount > 1;
}

/**
 * `/` でパネルを開くか。
 *
 * 入力欄が空のときだけに限定する。`docs/05_実装ノート.md` や `src/app.mts` のような
 * パスを日常的に打つので、カーソル位置を問わず開くと誤爆が止まらない。
 * スマホは日本語 IME で記号が打ちにくく全角「／」も混ざるため対象外 (🤖 ボタンを使う)。
 */
export function shouldTriggerSlash(
  { prevText, nextText, isDesktop, assistantInRoom }:
  { prevText: string; nextText: string; isDesktop: boolean; assistantInRoom: boolean }
): boolean {
  return isDesktop && assistantInRoom && prevText === '' && nextText.startsWith('/');
}

/**
 * 選んだ指示を入力欄にどう入れるか。
 *
 * 入力欄が空なら置き換え、書きかけがあれば末尾に足す。`/` で開いた場合は入力欄の中身が
 * 絞り込み文字列 (`/24h` 等) なので、まるごと捨てる。
 */
export function mergePromptInsertion(prevText: string, content: string, slashMode: boolean): string {
  const base = slashMode ? '' : prevText.trimEnd();
  return base ? `${base} ${content}` : content;
}

/** #346 onChange 1 打鍵ぶんの、slash / パネルに対する処分 */
export type SlashAction =
  | { kind: 'filter'; query: string }       // `/` 絞り込み中: query だけ更新
  | { kind: 'exit-slash' }                  // 先頭の `/` が消えた: slash を抜けてパネルも閉じる
  | { kind: 'close-panel' }                 // ボタンで開いた compose に打ち始めた: 閉じる
  | { kind: 'open-slash'; query: string }   // 空欄に `/`: slash で開く
  | { kind: 'none' };

/**
 * #346 候補2 (縮退版) 入力1打鍵に対する slash / パネルの処分。
 *
 * textarea の onChange に JSX 内インラインで書かれていた順序依存の if / else if を、
 * 判断だけここに出す (setState は呼び手に残す)。
 *
 * ★ 分岐の順序そのものが仕様:
 *   1. slashMode を最優先で見る — でないと `/` の絞り込み中に compose を閉じる枝へ
 *      落ちてパネルが消える。
 *   2. compose は打ち始めたら閉じる (改行の Enter を奪わないため)。ただし 'target-only'
 *      は宛先待ちで pendingAgentBody を抱えているので閉じない。
 *   3. 最後に `/` の開始判定 (shouldTriggerSlash)。
 */
export function nextSlashAction(
  { slashMode, panelMode, prevText, nextText, isDesktop, assistantInRoom }:
  {
    slashMode: boolean; panelMode: string | null;
    prevText: string; nextText: string; isDesktop: boolean; assistantInRoom: boolean;
  },
): SlashAction {
  if (slashMode) {
    return nextText.startsWith('/')
      ? { kind: 'filter', query: nextText.slice(1) }
      : { kind: 'exit-slash' };
  }
  if (panelMode === 'compose') return { kind: 'close-panel' };
  if (shouldTriggerSlash({ prevText, nextText, isDesktop, assistantInRoom })) {
    return { kind: 'open-slash', query: nextText.slice(1) };
  }
  return { kind: 'none' };
}

/** 変動する部分の位置 (content 上のオフセット) */
export interface Hole {
  start: number;
  end: number;
}

/**
 * #358 挿入直後に選択しておく範囲。
 *
 * 穴を選択状態で入れることで、打てば置き換わり・打たなければ前回値のまま、が両立する。
 * 穴が無ければ null を返し、呼び手は従来どおり末尾にカーソルを置く。
 * 穴が複数ある場合は最初の 1 つ (Tab での移動は Phase 2)。
 */
export function promptInsertionSelection(
  prevText: string, content: string, slashMode: boolean, holes: Hole[] | undefined,
): Hole | null {
  const hole = holes?.[0];
  if (!hole) return null;
  // mergePromptInsertion と同じ規則で、content が置かれる開始位置を求める
  const base = slashMode ? '' : prevText.trimEnd();
  const offset = base ? base.length + 1 : 0;
  return { start: offset + hole.start, end: offset + hole.end };
}
