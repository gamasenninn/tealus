import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MessageEditModal from '../../src/components/chat/MessageEditModal';
import type { MediaItem } from '../../src/types';

/**
 * #378: 添付音声つきメッセージの編集中に、音声を操作できるようにする。
 *
 * ★ 経緯: #376 で再生バーを足したのは ImageGrid (= バブル側) だけで、編集モーダルは
 * 素の textarea のままだった。モーダルはバブルを覆うので、編集中は裏の再生バーに
 * 触れない。一方 **音声メッセージ (type=voice) の編集 (VoiceEditModal) には最初から
 * プレイヤーが付いている** ため、同じ「音声を聞きながら文字を直す」作業なのに
 * 経路によって出来たり出来なかったりしていた。特別仕様の追加ではなく、不揃いの解消。
 *
 * ★ 条件は mime_type のみ。ルーム名で分岐しない (通話履歴専用の作りにしない)。
 */
const audio = (id: string, path: string): MediaItem => ({
  id, file_path: path, mime_type: 'audio/mp4', file_name: `${id}.m4a`,
});

describe('MessageEditModal — 添付音声のプレイヤー (#378)', () => {
  it('★ 音声の添付があれば、編集画面に再生バーを出す', () => {
    const { container } = render(
      <MessageEditModal
        initialText="文字起こし本文"
        media={[audio('m1', 'calls/a.m4a')]}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const el = container.querySelector('audio');
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute('controls');
    expect(el).toHaveAttribute('src', '/media/calls/a.m4a');
  });

  it('★ 音声以外の添付では出さない (画像・書類で再生バーが出ない)', () => {
    const { container } = render(
      <MessageEditModal
        initialText="本文"
        media={[
          { id: 'i1', file_path: 'p/x.jpg', mime_type: 'image/jpeg' },
          { id: 'f1', file_path: 'p/y.pdf', mime_type: 'application/pdf' },
        ]}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector('audio')).toBeNull();
  });

  it('音声が複数あれば その数だけ出す', () => {
    const { container } = render(
      <MessageEditModal
        initialText="本文"
        media={[audio('m1', 'a.m4a'), audio('m2', 'b.m4a')]}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('audio')).toHaveLength(2);
  });

  it('media を渡さない既存の呼び出しでも壊れない (後方互換)', () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <MessageEditModal initialText="もとの本文" onConfirm={onConfirm} onClose={vi.fn()} />,
    );
    expect(container.querySelector('audio')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue('もとの本文');
  });

  it('★ 再生バーを出しても、本文の編集と確定は従来どおり', () => {
    const onConfirm = vi.fn();
    render(
      <MessageEditModal
        initialText="もと"
        media={[audio('m1', 'a.m4a')]}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '直した本文' } });
    fireEvent.click(screen.getByText('確定'));
    expect(onConfirm).toHaveBeenCalledWith('直した本文');
  });
});

/**
 * 開いた直後のフォーカス。
 *
 * ★ 経緯 (2026-09-05): textarea に autoFocus が付いており、スマホで編集を開くと
 * 仮想キーボードが自動で立ち上がっていた。編集画面は textarea の**上**に音声プレイヤーと
 * 時刻シークバーを載せている (#378 / #398) ので、キーボードが画面の半分を占めると
 * 「聞きながら直す」の**聞く方が先に潰れる**。
 *
 * ★ 「どこにも当てない」ではなく **modal-box に当てる**。当てないとフォーカスが body に
 *   残り、Tab が裏のトーク画面へ抜ける。確定ボタンには当てない (Enter/Space で誤発火する)。
 *
 * ★ タップすれば当然キーボードは出る。ここで止めているのは「勝手に出る」だけ。
 */
describe('MessageEditModal — 開いた直後のフォーカス', () => {
  it('★ textarea にフォーカスを当てない (スマホでキーボードが勝手に出ない)', () => {
    const { container } = render(
      <MessageEditModal initialText="本文" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    const textarea = container.querySelector('textarea')!;
    expect(textarea).not.toHaveAttribute('autofocus');
    expect(document.activeElement).not.toBe(textarea);
  });

  it('★ 代わりに modal-box にフォーカスが移る (Tab が裏の画面へ抜けない)', () => {
    const { container } = render(
      <MessageEditModal initialText="本文" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(document.activeElement).toBe(container.querySelector('.modal-box'));
  });

  it('★ 確定ボタンには当てない (Enter/Space での誤発火を避ける)', () => {
    render(<MessageEditModal initialText="本文" onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(document.activeElement).not.toBe(screen.getByText('確定'));
  });
});
