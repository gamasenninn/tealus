/**
 * #619 音声・写真の送信に失敗したとき、手元に残して「もう一度送る」(2026-11-27)。
 * ★ 送れていたのに返事だけ来なかった (電波が途中で切れた) ときに二重に送らないよう、
 *   もう一度送る前に部屋を読み直し、送る前の最後の投稿より後に自分の同じ種類の投稿があれば送らない。
 *   時計でなく投稿の並びで比べる (端末と本体の時計のずれに左右されない)
 */
export type FailedKind = 'voice' | 'media';

interface Msg { id: string; sender_id: string; type: string }

const KIND_TYPES: Record<FailedKind, string[]> = {
  voice: ['voice'],
  media: ['image', 'video', 'file'],
};

/** 送る前の部屋の最後の投稿 (並びは古い → 新しい)。空なら null */
export function lastMessageId(messages: Msg[]): string | null {
  return messages.length > 0 ? messages[messages.length - 1].id : null;
}

/**
 * 送る前の最後の投稿 (sinceId) より後に、自分の同じ種類の投稿があるか。
 * sinceId が読み直した中に無い (間に 1 ページより多く投稿があった) ときは確かめられないので false
 */
export function arrivedAfter(messages: Msg[], sinceId: string | null, myId: string, kind: FailedKind): boolean {
  let start = 0;
  if (sinceId !== null) {
    const i = messages.findIndex((x) => x.id === sinceId);
    if (i < 0) return false;
    start = i + 1;
  }
  return messages.slice(start).some((x) => x.sender_id === myId && KIND_TYPES[kind].includes(x.type));
}
