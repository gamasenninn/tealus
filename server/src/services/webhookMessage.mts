/**
 * AI へ渡す `message.created` の message 部分 (改善ループ 66、#649 A-4)。送る所はすべてここで作る。
 *
 * ★ 以前は送る所 4 か所 (socket の投稿・音声・転送・Bot の投稿) が手で組み立てていて、形がばらばらだった。
 *   受け側 (agent-server の types.mts) が当てにしている添付 (media) と作った時刻 (created_at) はどこからも送られず、
 *   転送されたファイルの便は AI から見てファイル名が「不明なファイル」になっていた。
 * ★ 添付はファイル名・種類・大きさだけ。置き場の道 (file_path) は載せない (中身は AI が bot の口で取りに行く)
 */
export interface WebhookMessageSource {
  id: string;
  type: string;
  content: string | null;
  /** ★ DB の行 (RETURNING *) には必ずある。型の上で持たない行もあるので任意にし、無ければ載せない */
  created_at?: string | Date | null;
  reply_to?: string | null;
  reply_to_message?: unknown;
  media?: Array<{ file_name?: string | null; mime_type?: string | null; file_size?: number | string | null; file_path?: string | null }>;
}

export interface WebhookMessage {
  id: string;
  type: string;
  content: string | null;
  created_at?: string;
  reply_to: string | null;
  reply_to_message: unknown;
  forwarded_from?: string;
  media?: Array<{ file_name: string | null; mime_type: string | null; file_size: number | null }>;
  sender: { id: string; display_name: string };
}

export function webhookMessage(a: {
  message: WebhookMessageSource;
  sender: { id: string; display_name: string };
  forwardedFrom?: string;
}): WebhookMessage {
  const m = a.message;
  const out: WebhookMessage = {
    id: m.id,
    type: m.type,
    content: m.content,
    reply_to: m.reply_to ?? null,
    reply_to_message: m.reply_to_message ?? null,
    sender: { id: a.sender.id, display_name: a.sender.display_name },
  };
  if (m.created_at) out.created_at = m.created_at instanceof Date ? m.created_at.toISOString() : m.created_at;
  if (a.forwardedFrom) out.forwarded_from = a.forwardedFrom;
  if (m.media && m.media.length > 0) {
    out.media = m.media.map((x) => ({
      file_name: x.file_name ?? null,
      mime_type: x.mime_type ?? null,
      file_size: x.file_size == null ? null : Number(x.file_size),
    }));
  }
  return out;
}
