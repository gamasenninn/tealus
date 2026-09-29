/**
 * #476 トーク画面で日付の頭へ飛ぶ
 *
 * ★ 日付の札を position: sticky で上に貼り付けるには、札が「その日のまとまり」の直下に要る。
 *   以前は札が投稿 1 件の枠の中にあり、その 1 件と一緒に画面の外へ流れていた。
 */

/** 見ている人の時刻での YYYY-MM-DD */
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface DayGroup<T> { day: string; firstCreatedAt: string; messages: T[] }

/** 隣り合う同じ日の投稿を 1 つのまとまりにする。並びは変えない */
export function groupByDay<T extends { created_at: string }>(messages: T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const m of messages) {
    const day = localDayKey(m.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.messages.push(m);
    else groups.push({ day, firstCreatedAt: m.created_at, messages: [m] });
  }
  return groups;
}

export interface JumpDeps {
  getFirst: (roomId: string, date: string) => Promise<{ message_id: string | null }>;
  dispatch: (messageId: string) => void;
}

/**
 * その日の最初の投稿を引いて、そこへ飛ぶ。
 * ★ 飛ぶのは #256 の 'message:scroll-to' (読み込んでいなければ around で読み直してから点滅)。
 * @returns 飛んだら true。投稿が無い・取れなかったら false
 */
export async function jumpToDate(roomId: string, date: string, deps: JumpDeps): Promise<boolean> {
  try {
    const { message_id } = await deps.getFirst(roomId, date);
    if (!message_id) return false;
    deps.dispatch(message_id);
    return true;
  } catch {
    return false;
  }
}
