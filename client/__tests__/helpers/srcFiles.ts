/**
 * src のファイルを文字として読む (テスト用、改善ループ 42)。
 * ★ vitest は CSS を空の文字として渡す (import.meta.glob の ?raw も) ので、ファイルを直接読む。
 * ★ 画面の型検査では Node の型が揃っていない (__dirname が無い・読んだ値が any) ので、使う関数の型だけここで付ける
 *   (10-10 に node:fs を素で書いて CI の型検査を落とした)
 */
import * as fs from 'node:fs';

interface FsLike {
  readFileSync(p: string, enc: 'utf8'): string;
  readdirSync(p: string, o: { recursive: true }): string[];
}
const nodeFs = fs as unknown as FsLike;
// ★ jsdom の環境では import.meta.url が file: でないので、作業ディレクトリ (vitest は client で動く) から組み立てる
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd().split('\\').join('/');
const SRC = `${cwd}/src/`;

/** src からの相対パスで 1 つ読む (例: 'styles/markdown.css') */
export function readSrc(rel: string): string {
  return nodeFs.readFileSync(SRC + rel, 'utf8');
}

/** src の下で名前が合うものを全部読む */
export function readSrcFiles(match: RegExp): { path: string; text: string }[] {
  return nodeFs.readdirSync(SRC, { recursive: true })
    .map((p) => p.split('\\').join('/'))   // Windows の区切り
    .filter((p) => match.test(p))
    .map((p) => ({ path: p, text: readSrc(p) }));
}
