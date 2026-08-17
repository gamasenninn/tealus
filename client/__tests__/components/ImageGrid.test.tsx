/**
 * ImageGrid の添付振り分け test
 *
 * ★ 音声添付 (通話履歴の .m4a) が「クリックで即ダウンロード」しか無かった問題の regression guard。
 *   動画は既にその場で再生できるのに、音声だけ「それ以外」に落ちて download 属性の
 *   リンクになっていた (#246 で意図的に入れた download 属性の巻き添え)。
 *   → 音声もその場に再生バーを出す。★ ダウンロードは今までどおり残す (消さない)。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ImageGrid, { type GridMediaItem } from '../../src/components/media/ImageGrid';

const audio = (over: Partial<GridMediaItem> = {}): GridMediaItem => ({
  id: 'a1', mime_type: 'audio/mp4', file_name: 'sum_83933.m4a', file_path: 'calls/sum_83933.m4a',
  ...over,
} as GridMediaItem);

const noop = () => {};

describe('音声添付は その場に再生バーを出す', () => {
  it('★ audio/* は <audio controls> を描画する', () => {
    const { container } = render(<ImageGrid media={[audio()]} onImageClick={noop} />);
    const el = container.querySelector('audio');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('src')).toBe('/media/calls/sum_83933.m4a');
    expect(el!.hasAttribute('controls')).toBe(true);
  });

  it('★ 一覧に何件並んでも重くならないよう preload は metadata (全部を先読みしない)', () => {
    const { container } = render(<ImageGrid media={[audio()]} onImageClick={noop} />);
    expect(container.querySelector('audio')!.getAttribute('preload')).toBe('metadata');
  });

  it('★★ ダウンロードは残す — 原本名で保存できるリンクが併存する (#246 を壊さない)', () => {
    render(<ImageGrid media={[audio()]} onImageClick={noop} />);
    const link = screen.getByText(/sum_83933\.m4a/).closest('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('download')).toBe('sum_83933.m4a');
    expect(link!.getAttribute('href')).toBe('/media/calls/sum_83933.m4a');
  });

  it('mime が audio/mpeg / audio/wav でも再生バーになる', () => {
    for (const mime of ['audio/mpeg', 'audio/wav', 'audio/ogg']) {
      const { container, unmount } = render(<ImageGrid media={[audio({ mime_type: mime })]} onImageClick={noop} />);
      expect(container.querySelector('audio')).not.toBeNull();
      unmount();
    }
  });
});

describe('音声以外の振り分けは変えない', () => {
  it('動画は従来どおり <video> のまま (音声用の分岐に吸われない)', () => {
    const { container } = render(
      <ImageGrid media={[audio({ id: 'v1', mime_type: 'video/mp4', file_name: 'a.mp4', file_path: 'p/a.mp4' })]} onImageClick={noop} />,
    );
    expect(container.querySelector('video')).not.toBeNull();
    expect(container.querySelector('audio')).toBeNull();
  });

  it('★ 書類は従来どおり ダウンロードリンクのみ (再生バーを出さない)', () => {
    const { container } = render(
      <ImageGrid media={[audio({ id: 'd1', mime_type: 'application/pdf', file_name: 'x.pdf', file_path: 'p/x.pdf' })]} onImageClick={noop} />,
    );
    expect(container.querySelector('audio')).toBeNull();
    expect(screen.getByText(/x\.pdf/).closest('a')!.getAttribute('download')).toBe('x.pdf');
  });

  it('画像は grid に入り、file リンクにはならない', () => {
    const { container } = render(
      <ImageGrid media={[audio({ id: 'i1', mime_type: 'image/jpeg', file_name: 'x.jpg', file_path: 'p/x.jpg' })]} onImageClick={noop} />,
    );
    expect(container.querySelector('.image-grid')).not.toBeNull();
    expect(container.querySelector('audio')).toBeNull();
  });
});
