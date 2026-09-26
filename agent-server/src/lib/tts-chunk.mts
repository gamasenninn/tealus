/**
 * 長い文を分けて並行に合成し、1 つの WAV につなぐための部品 (2026-09-26)。
 *
 * ★ Gemini (tts-gemini.mts) と OpenAI (tts-openai.mts) が同じものを使う (★★ 同じ仕事を 2 か所に書かない)。
 * ★ なぜ要るか: どちらも長さに比例して遅く (自然な文で 1200 字 30〜37 秒)、読み上げボタン (全文、最大 3000 字) が
 *   時間切れになった。OpenAI は 1 回 2000 トークンの上限もある。
 * ★★ 長さの試験に **同じ文の繰り返しを使わない** —— TTS も文字起こしも繰り返しを飛ばしたりループしたりして、
 *   「読み飛ばしている」ように見える (2026-09-26 に Gemini について誤った結論を出した)。
 */

/** ★ ここで切ってよい文字 (★ 直後で切る)。句点・感嘆・疑問・改行 */
const SENTENCE_END = /[。！？!?\n]/;
/** ★ 句点が無いときの次善 */
const SOFT_END = /[、，,　 ]/;

/**
 * 文の切れ目で分ける。★★★ `join('')` で元に戻る (1 文字も欠けない) ことをテストで固定している。
 * ★ 1 つは max 字以下。句点の直後で切り、無ければ読点の直後、それも無ければ字数で切る。
 */
export function splitForTts(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const head = rest.slice(0, max);
    let cut = -1;
    for (let i = head.length - 1; i >= 0; i--) if (SENTENCE_END.test(head[i])) { cut = i + 1; break; }
    if (cut <= 0) for (let i = head.length - 1; i >= 0; i--) if (SOFT_END.test(head[i])) { cut = i + 1; break; }
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length) out.push(rest);
  // ★ 空白だけのかけら (改行の連続など) は前のかけらに寄せる (★ 合成に投げない、でも文字は欠かさない)
  const merged: string[] = [];
  for (const p of out) {
    if (!p.trim() && merged.length) merged[merged.length - 1] += p;
    else merged.push(p);
  }
  return merged;
}

/** WAV から fmt と data (PCM) を取り出す。★ data の前に LIST 等があっても読み飛ばす */
function readWav(buf: Buffer): { fmt: Buffer; pcm: Buffer } {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('TTS: WAV ではない音声が返った');
  }
  let fmt: Buffer | null = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, Math.min(buf.length, off + 8 + size));
    if (id === 'fmt ') fmt = Buffer.from(body);
    if (id === 'data') {
      if (!fmt) throw new Error('TTS: WAV に fmt がない');
      return { fmt, pcm: body };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('TTS: WAV に data がない');
}

/**
 * ★ WAV を順につなぐ。形式は 1 本目のものを使う (★ 同じモデル・同じ設定なので揃っている)。
 * ★★ data の長さ欄が 0xFFFFFFFF (OpenAI が流しながら作る WAV) でも、ファイルの終わりまでを PCM として読む。
 */
export function concatWav(buffers: Buffer[]): Buffer {
  const parts = buffers.map(readWav);
  const fmt = parts[0].fmt;
  const pcm = Buffer.concat(parts.map((p) => p.pcm));
  const head = Buffer.alloc(12 + 8 + fmt.length + 8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(head.length - 8 + pcm.length, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(fmt.length, 16);
  fmt.copy(head, 20);
  head.write('data', 20 + fmt.length, 'ascii');
  head.writeUInt32LE(pcm.length, 24 + fmt.length);
  return Buffer.concat([head, pcm]);
}

/** ★ 同時 limit 本までで順に処理し、結果は入力と同じ順で返す */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
