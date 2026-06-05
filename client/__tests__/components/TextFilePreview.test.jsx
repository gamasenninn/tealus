/**
 * TextFilePreview component test (= #289 Phase 2.1)
 *
 * 役割:
 * - isTextFile / isMarkdownFile pure helper の判定 logic 固定
 * - expand/collapse behavior + fetch (= UTF-8 decode) + markdown rendering の verify
 * - Chrome Android で raw markdown が文字化けする問題への inline preview 回避策の regression guard
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TextFilePreview, { isTextFile, isMarkdownFile } from '../../src/components/media/TextFilePreview';

describe('isTextFile (= preview 対象判定)', () => {
  it('mime text/* は text', () => {
    expect(isTextFile({ mime_type: 'text/plain', file_name: 'x.bin' })).toBe(true);
    expect(isTextFile({ mime_type: 'text/markdown', file_name: 'x' })).toBe(true);
  });

  it('mime application/json + xml は text', () => {
    expect(isTextFile({ mime_type: 'application/json' })).toBe(true);
    expect(isTextFile({ mime_type: 'application/xml' })).toBe(true);
  });

  it('拡張子 .md / .txt / .json / source code は text (= mime 不正確でも fallback)', () => {
    expect(isTextFile({ mime_type: 'application/octet-stream', file_name: 'notes.md' })).toBe(true);
    expect(isTextFile({ mime_type: 'application/octet-stream', file_name: 'log.txt' })).toBe(true);
    expect(isTextFile({ mime_type: 'application/octet-stream', file_name: 'config.json' })).toBe(true);
    expect(isTextFile({ mime_type: 'application/octet-stream', file_name: 'main.py' })).toBe(true);
    expect(isTextFile({ mime_type: 'application/octet-stream', file_name: 'index.js' })).toBe(true);
  });

  it('PDF / image / 不明 file は text ではない', () => {
    expect(isTextFile({ mime_type: 'application/pdf', file_name: 'doc.pdf' })).toBe(false);
    expect(isTextFile({ mime_type: 'image/jpeg', file_name: 'x.jpg' })).toBe(false);
    expect(isTextFile({ mime_type: 'application/octet-stream', file_name: 'mystery' })).toBe(false);
  });

  it('null / undefined safe', () => {
    expect(isTextFile(null)).toBe(false);
    expect(isTextFile(undefined)).toBe(false);
    expect(isTextFile({})).toBe(false);
  });
});

describe('isMarkdownFile', () => {
  it('.md / .markdown 拡張子 は markdown', () => {
    expect(isMarkdownFile({ file_name: 'notes.md' })).toBe(true);
    expect(isMarkdownFile({ file_name: 'README.markdown' })).toBe(true);
  });

  it('mime text/markdown も markdown', () => {
    expect(isMarkdownFile({ mime_type: 'text/markdown', file_name: 'x' })).toBe(true);
  });

  it('.txt / .json 等は markdown ではない', () => {
    expect(isMarkdownFile({ file_name: 'log.txt' })).toBe(false);
    expect(isMarkdownFile({ file_name: 'data.json' })).toBe(false);
  });
});

describe('TextFilePreview component', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('default = 折り畳み (= body 非表示)', () => {
    const media = { file_path: 'line-files/x.md', file_name: 'x.md', mime_type: 'text/markdown' };
    render(<TextFilePreview media={media} />);
    expect(screen.getByRole('button', { name: /プレビューを開く/ })).toBeInTheDocument();
    expect(screen.queryByText(/読み込み中/)).not.toBeInTheDocument();
  });

  it('toggle button click で fetch (= UTF-8 decode) + markdown rendering', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# 五千言\n\n本文の日本語テキスト'),
    });

    const media = { file_path: 'line-files/x.md', file_name: 'x.md', mime_type: 'text/markdown' };
    render(<TextFilePreview media={media} />);

    fireEvent.click(screen.getByRole('button', { name: /プレビューを開く/ }));

    await waitFor(() => expect(screen.getByText('五千言')).toBeInTheDocument());
    expect(screen.getByText(/本文の日本語テキスト/)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith('/media/line-files/x.md');
  });

  it('非 markdown は <pre> raw 表示 (= source code / log 等)', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('console.log("hello");'),
    });

    const media = { file_path: 'line-files/x.js', file_name: 'x.js', mime_type: 'application/octet-stream' };
    const { container } = render(<TextFilePreview media={media} />);
    fireEvent.click(screen.getByRole('button', { name: /プレビューを開く/ }));

    await waitFor(() => expect(container.querySelector('pre')).toBeInTheDocument());
    expect(container.querySelector('pre').textContent).toBe('console.log("hello");');
  });

  it('fetch fail (= 404 等) で error 表示', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 404 });

    const media = { file_path: 'line-files/missing.md', file_name: 'missing.md', mime_type: 'text/markdown' };
    render(<TextFilePreview media={media} />);
    fireEvent.click(screen.getByRole('button', { name: /プレビューを開く/ }));

    await waitFor(() => expect(screen.getByText(/エラー/)).toBeInTheDocument());
    expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
  });

  it('再度 toggle で collapse (= body 非表示、★ ただし content は cache、再 fetch なし)', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('cached content'),
    });

    const media = { file_path: 'line-files/x.txt', file_name: 'x.txt', mime_type: 'text/plain' };
    render(<TextFilePreview media={media} />);

    fireEvent.click(screen.getByRole('button', { name: /プレビューを開く/ }));
    await waitFor(() => expect(screen.getByText('cached content')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /プレビューを閉じる/ }));
    expect(screen.queryByText('cached content')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /プレビューを開く/ }));
    expect(screen.getByText('cached content')).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // ★ cache hit
  });
});
