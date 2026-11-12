/**
 * 停止で捨てる仕事を、その部屋に知らせる (改善ループ 45、2026-11-12)。
 *
 * ★ 部屋ごとの仕事の列 (dispatcher.mts の roomQueues) はメモリの中だけにある。受け口は先に 200 を返すので
 *   本体の再送も効かず、停止すると走っている仕事と待っている仕事が黙って消えていた。
 *   実例: 11-05 18:40:20 の停止で 走り 1 + 待ち 6 (蒲さんの依頼の言い直し)。ログにも部屋にも痕跡が無く、
 *   画面の「考え中」も idle が来ないので残った。
 * ★ ここでするのは「黙って消えない」だけ。取り直して走らせ直すことはしない
 *   (11-05 の例では同じ依頼が 6 回走る。取り直すかどうかは利用者の判断)
 * ★ 停止処理を止めない: 失敗は飲み込み、本体が応えなくても上限の時間で戻る
 */

export interface DroppedWorkDeps {
  pushStatus: (roomId: string, status: string) => Promise<unknown>;
  pushMessage: (roomId: string, content: string) => Promise<unknown>;
  log: (line: string) => void;
}

/**
 * ★ 数は「依頼」でなく「仕事」と書く (改善ループ 46)。列には AI に宛てていない便も入る
 *   (宛先の判定は列の中の _dispatch でする)。長い仕事の後ろに雑談が並ぶと、数が依頼の数より多くなる
 */
const DROPPED_WORK_HEAD = 'AI を再起動したため、この部屋で処理中・順番待ちだった仕事';

export function droppedWorkText(count: number): string {
  return `${DROPPED_WORK_HEAD} (${count} 件) が中断されました。AI に頼んでいた方は、お手数ですが必要ならもう一度送ってください。`;
}

/**
 * 改善ループ 46: 自分の停止の知らせか。handler の自分のボットの分岐で弾く (再起動した自分が拾って返事をしないように)。
 * ★ 部屋をまたぐ委譲を有効にしていると、自分の便も inflight でない部屋では通るため
 */
export function isDroppedWorkNotice(content: string | null | undefined): boolean {
  return typeof content === 'string' && content.startsWith(DROPPED_WORK_HEAD);
}

export async function noticeDroppedWork(
  pending: Array<{ roomId: string; count: number }>,
  deps: DroppedWorkDeps,
  timeoutMs: number,
): Promise<void> {
  if (pending.length === 0) return;
  const total = pending.reduce((n, p) => n + p.count, 0);
  // ★ 記録は先に残す (知らせが届かなくても、捨てた数はログに残る)
  deps.log(`[shutdown] 終わっていない仕事 ${total} 件を捨てます: ${pending.map((p) => `room=${p.roomId} ${p.count}`).join(', ')}`);

  const all = Promise.allSettled(pending.map(async (p) => {
    await deps.pushStatus(p.roomId, 'idle').catch(() => {});   // 画面の「考え中」を消す
    await deps.pushMessage(p.roomId, droppedWorkText(p.count)).catch(() => {});
  }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((r) => { timer = setTimeout(r, timeoutMs); });
  await Promise.race([all, limit]);
  if (timer) clearTimeout(timer);
}
