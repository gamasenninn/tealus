/**
 * 大きすぎる添付は、受け取りながら上限を超えた時点で断る (2026-10-30 小野さん判断 M、#529 K の残り)
 * ★ 以前は全部 (最大 1GB) を受け取って保存してから種類ごとの上限を確かめていた。回線と本体の書き込みが無駄だった
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { limitedDiskStorage } from '../../src/middleware/upload.mts';

const MB = 1024 * 1024;

function handle(dir: string, mimetype: string, totalBytes: number) {
  let produced = 0;
  const stream = new Readable({
    read() {
      if (produced >= totalBytes) { this.push(null); return; }
      const n = Math.min(MB, totalBytes - produced);
      produced += n;
      this.push(Buffer.alloc(n));
    },
  });
  const engine = limitedDiskStorage(() => dir);
  return new Promise<{ err: (Error & { code?: string; limitMb?: number }) | null; info?: { path: string; size: number }; producedAtCb: number }>((resolve) => {
    engine._handleFile({} as never, { fieldname: 'files', originalname: 'x.png', mimetype, stream } as never,
      (err: unknown, info?: Partial<Express.Multer.File>) => resolve({ err: err as never, info: info as never, producedAtCb: produced }));
  });
}

describe('limitedDiskStorage', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tealus-upload-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('★★ 画像が 10MB を超えた時点で断り (全部は読まない)、途中のファイルを残さない', async () => {
    const r = await handle(dir, 'image/png', 50 * MB);
    expect(r.err?.code).toBe('LIMIT_FILE_SIZE');
    expect(r.err?.limitMb).toBe(10);
    expect(r.producedAtCb).toBeLessThan(50 * MB);
    await new Promise((res) => setTimeout(res, 50));
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('上限ちょうどは通る (サイズと保存先を返す)', async () => {
    const r = await handle(dir, 'image/png', 10 * MB);
    expect(r.err).toBeNull();
    expect(r.info?.size).toBe(10 * MB);
    expect(fs.statSync(r.info!.path).size).toBe(10 * MB);
  });
});
