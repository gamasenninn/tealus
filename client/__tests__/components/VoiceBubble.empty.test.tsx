import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Message } from '../../src/types';

/**
 * #583 文字起こしが空のまま「完了」(done) になったとき、吹き出しを白紙にしない。
 * ★ Gemini が空 → OpenAI でやり直しても空 (無音の録音) のとき、サーバは本文が空の done で終える
 *   (10-01 に fail-open は変えないと判断)。画面は本文をそのまま出していたので、文字の欄が白紙だった
 */
vi.mock('../../src/services/api', () => ({ api: {} }));
vi.mock('../../src/stores/confirmStore', () => ({ useConfirm: () => vi.fn(), notify: vi.fn() }));

import VoiceBubble from '../../src/components/chat/VoiceBubble';

const message = { id: 'm1', room_id: 'r1', type: 'voice', content: '' } as unknown as Message;

function renderWith(raw: string | null, formatted: string | null, canEdit = false) {
  return render(
    <VoiceBubble
      message={message}
      media={[{ id: 'a1', file_path: '/media/a.webm' } as never]}
      transcription={{ status: 'done', raw_text: raw, formatted_text: formatted, version: 1 }}
      isOwn={false}
      canEditTranscription={canEdit}
    />,
  );
}

describe('#583 空の文字起こし', () => {
  it('★ 本文が空なら「聞き取れませんでした」と出す', () => {
    renderWith('', '');
    expect(screen.getByText(/聞き取れませんでした/)).toBeTruthy();
  });

  it('★ 空白だけ (全角を含む) も空として扱う', () => {
    renderWith(' \n　', null);
    expect(screen.getByText(/聞き取れませんでした/)).toBeTruthy();
  });

  it('本文があればそのまま出し、「聞き取れませんでした」は出さない', () => {
    renderWith('こんにちは', null);
    expect(screen.getByText('こんにちは')).toBeTruthy();
    expect(screen.queryByText(/聞き取れませんでした/)).toBeNull();
  });

  it('空でも、編集できる人には再文字起こしのボタンを出す', () => {
    renderWith('', '', true);
    expect(screen.getByText('再文字起こし')).toBeTruthy();
  });
});
