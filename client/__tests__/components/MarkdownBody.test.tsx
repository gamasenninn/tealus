/**
 * Markdown を描く 3 か所が共通の本文の規則 (.md-body, styles/markdown.css) を使う (改善ループ 42)
 *
 * ★ 2026-11-07 MD のプレビューで箇条書きの点が枠の外に出た。index.css の `* { padding: 0 }` で潰れる要素を
 *   場所ごとに戻していて、戻し忘れが場所ごとに違った (お知らせは見出し・表・hr、プレビューは表・引用・hr、
 *   吹き出しは h4〜h6・img・タスクリスト)。1 か所にまとめて、3 か所ともそれを使う
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readSrc } from '../helpers/srcFiles';

vi.mock('../../src/services/api', () => ({ api: { request: vi.fn(), get: vi.fn() } }));

import MessageBubble from '../../src/components/chat/MessageBubble';
import TextFilePreview from '../../src/components/media/TextFilePreview';
import type { Message } from '../../src/types';

const MD = '## 見出し\n\n- [ ] まだ\n- [x] 済み\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';

describe('吹き出し', () => {
  const base = {
    id: 'm1', room_id: 'R1', sender_id: 'u1', reply_to: null, is_deleted: false,
    created_at: '2026-11-08T01:00:00.000Z', updated_at: '2026-11-08T01:00:00.000Z',
    sender_display_name: '送り手', sender_avatar_url: null,
  };
  const renderBubble = (content: string) => render(
    <MemoryRouter initialEntries={['/rooms/R1']}>
      <Routes><Route path="/rooms/:roomId" element={
        <MessageBubble message={{ ...base, type: 'text', content } as Message} isOwn={false} />
      } /></Routes>
    </MemoryRouter>,
  );

  it('★ 本文は .md-body の中に描く', () => {
    const { container } = renderBubble(MD);
    expect(container.querySelector('.bubble-markdown.md-body h2')).not.toBeNull();
  });

  it('★ 箇条書きの差し替えで class を落とさない (タスクリストの点と箱の二重を規則で消せるように)', () => {
    const { container } = renderBubble(MD);
    expect(container.querySelectorAll('li.task-list-item')).toHaveLength(2);
  });
});

describe('MD ファイルのプレビュー', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('★ 本文は .md-body の中に描く', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: () => Promise.resolve(MD) })));
    const media = { file_path: 'line-files/x.md', file_name: 'x.md', mime_type: 'text/markdown' };
    const { container } = render(<TextFilePreview media={media} />);
    fireEvent.click(screen.getByRole('button', { name: /プレビューを開く/ }));
    await waitFor(() => expect(screen.getByText('見出し')).toBeInTheDocument());
    expect(container.querySelector('.text-file-preview__markdown.md-body h2')).not.toBeNull();
  });
});

describe('お知らせ (ホーム)', () => {
  it('★ 本文の包みに md-body が付いている', () => {
    const src = readSrc('components/home/HomePage.tsx');
    expect(src).toMatch(/className=\{`announcement-body md-body /);
  });
});

describe('styles/markdown.css', () => {
  const css = readSrc('styles/markdown.css');
  it.each(['ul', 'h4', 'h6', 'blockquote', 'table', 'th', 'pre', 'hr', 'img', 'li.task-list-item', '.sr-only'])(
    '%s の規則がある', (sel) => {
      expect(css).toContain(`:where(.md-body) ${sel}`);
    },
  );
  it('★ 画面の入口で読み込まれている', () => {
    const main = readSrc('main.tsx');
    expect(main).toContain("import './styles/markdown.css'");
  });
});
