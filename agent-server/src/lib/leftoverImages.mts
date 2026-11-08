/**
 * #645 Deep (codex) が時間切れになったとき、その回に作った画像を拾う。
 *
 * ★ codex の内蔵の画像生成は `<CODEX_HOME>/generated_images/<thread>/exec-*.png` に落とすだけで、投稿は別に要る。
 *   2026-11-05 に 16 枚の依頼で 9 枚できたところで 8 分で打ち切られ、全部作ってから確認して投稿する計画だったので
 *   投稿 0 枚だった。時間切れの処理がこの置き場を見ていなかった
 */
import fs from 'node:fs';
import path from 'node:path';

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** `<codexHome>/generated_images` の下で、sinceMs 以降にできた画像を、できた順に max 枚まで */
export function listGeneratedImagesSince(codexHome: string, sinceMs: number, max = 20): string[] {
  const root = path.join(codexHome, 'generated_images');
  const found: { file: string; at: number }[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (IMAGE_EXT.test(e.name)) {
        try {
          const at = fs.statSync(p).mtimeMs;
          if (at >= sinceMs) found.push({ file: p, at });
        } catch { /* 読めないものは飛ばす */ }
      }
    }
  };
  walk(root);
  return found.sort((a, b) => a.at - b.at).slice(0, max).map((f) => f.file);
}

/** できた分を 1 枚ずつ投稿し、投稿できた枚数を返す (1 枚の失敗で残りを止めない) */
export async function postLeftoverImages(
  codexHome: string,
  sinceMs: number,
  push: (buffer: Buffer, filename: string) => Promise<unknown>,
  max = 20,
): Promise<number> {
  let sent = 0;
  for (const file of listGeneratedImagesSince(codexHome, sinceMs, max)) {
    try {
      await push(fs.readFileSync(file), path.basename(file));
      sent++;
    } catch { /* 次へ */ }
  }
  return sent;
}

interface ToolEvent { type?: string; item?: { type?: string; tool?: string; status?: string } }

/** codex の event が「画像を部屋に投稿した道具の完了」か (この回で既に画像を出していれば、時間切れで拾い直さない) */
export function isImagePostToolCall(event: ToolEvent | null | undefined): boolean {
  if (!event || event.type !== 'item.completed' || event.item?.type !== 'mcp_tool_call') return false;
  if (event.item.status && event.item.status !== 'completed') return false;
  return event.item.tool === 'send_image' || event.item.tool === 'generate_and_send_image';
}
