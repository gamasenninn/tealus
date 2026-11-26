/**
 * 文字起こしの知らせ (socket の 'voice:transcription') を配る口 (#664)。
 * ★ 6 か所 (文字起こし・整形・整形の失敗・手直し) が手で組み立てていたので、知らせの名前と形をここに 1 つ置く。
 *   中身は以前と同じ (呼ぶ側が渡したものをそのまま配る)。画面の受け手は client/src/hooks/useSocketSync.ts
 * - status 'formatting': 生の文字だけ先に (整形はこれから)
 * - status 'done': 整形まで済んだ (整形に失敗したときは formatted_text: null)
 */
export interface VoiceTranscriptionEvent {
  message_id: string;
  status: 'formatting' | 'done';
  raw_text: string | null;
  formatted_text?: string | null;
  version?: number;
}

interface RoomEmitter {
  to(room: string): { emit(event: string, payload: unknown): unknown };
}

/** io か部屋が無ければ何もしない (テストや部屋の分からない経路) */
export function emitVoiceTranscription(io: RoomEmitter | null | undefined, roomId: string | null | undefined, event: VoiceTranscriptionEvent): void {
  if (!io || !roomId) return;
  io.to(roomId).emit('voice:transcription', event);
}
