import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FormSchema, Message } from '../../src/types';

// api / socket / messageStore をモック (送信検証用)。REST 経路は sendRoomMessage 経由で api.sendMessage を叩く。
const requestMock = vi.fn().mockResolvedValue({});
const sendMessageMock = vi.fn().mockResolvedValue({});
vi.mock('../../src/services/api', () => ({
  api: { request: (...a: unknown[]) => requestMock(...a), sendMessage: (...a: unknown[]) => sendMessageMock(...a) },
}));
const emitMock = vi.fn();
let socketConnected = true;
vi.mock('../../src/services/socket', () => ({
  getSocket: () => ({ get connected() { return socketConnected; }, emit: (...a: unknown[]) => emitMock(...a) }),
}));
const fetchMessagesMock = vi.fn().mockResolvedValue(undefined);
// hook-selector 対応 mock (二重回答防止の store 導出用)。messages は test ごとに差し替え。
const mockStore = vi.hoisted(() => ({ messages: [] as Array<Record<string, unknown>> }));
vi.mock('../../src/stores/messageStore', () => {
  const state = () => ({ messages: mockStore.messages, fetchMessages: fetchMessagesMock });
  const useMessageStore = (selector?: (s: ReturnType<typeof state>) => unknown) =>
    (selector ? selector(state()) : state());
  (useMessageStore as { getState?: () => ReturnType<typeof state> }).getState = () => state();
  return { useMessageStore };
});
vi.mock('../../src/stores/authStore', () => ({
  useAuthStore: (selector?: (s: { user: { id: string } }) => unknown) => {
    const s = { user: { id: 'u1' } };
    return selector ? selector(s) : s;
  },
}));

import FormBubble from '../../src/components/chat/FormBubble';

const SCHEMA: FormSchema = {
  version: 1,
  title: 'Day59 Q0',
  reply_mention: '@cc-organon',
  fields: [
    {
      id: 'q1', type: 'radio', label: '笹沼さんは?', required: true,
      options: [
        { value: 'record', label: '記録のみ' },
        { value: 'other', label: 'その他', allow_text: true, text_label: '補足' },
      ],
    },
    { id: 'q2', type: 'text', label: '記録方針', multiline: true },
  ],
};

const MSG = { id: 'form-msg-1', type: 'form' } as Message;

describe('FormBubble', () => {
  beforeEach(() => { requestMock.mockClear(); sendMessageMock.mockClear(); fetchMessagesMock.mockClear(); emitMock.mockClear(); socketConnected = true; mockStore.messages = []; });

  it('title と radio option / text field を描画', () => {
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    expect(screen.getByText(/Day59 Q0/)).toBeTruthy();
    expect(screen.getByText('記録のみ')).toBeTruthy();
    expect(screen.getByText('その他')).toBeTruthy();
    expect(screen.getByText('笹沼さんは?')).toBeTruthy();
  });

  it('required 未選択なら送信ボタンが disabled', () => {
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    const btn = screen.getByRole('button', { name: '回答する' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('allow_text 付き option 選択で補足欄が出る', () => {
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    // 初期は補足欄なし
    expect(screen.queryByPlaceholderText('補足')).toBeNull();
    fireEvent.click(screen.getByLabelText('その他'));
    expect(screen.getByPlaceholderText('補足')).toBeTruthy();
  });

  it('★ socket 接続時は message:send で送る (webhook 発火経路 = cc-queue 起動)', async () => {
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    fireEvent.click(screen.getByLabelText('記録のみ'));
    const btn = screen.getByRole('button', { name: '回答する' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(emitMock).toHaveBeenCalledTimes(1));
    const [event, payload] = emitMock.mock.calls[0];
    expect(event).toBe('message:send');
    expect(payload.room_id).toBe('room1');
    expect(payload.reply_to).toBe('form-msg-1');
    expect(payload.content.startsWith('@cc-organon\n')).toBe(true); // 先頭 mention = cc-queue trigger
    expect(payload.content).toContain('笹沼さんは?: 記録のみ');
    expect(requestMock).not.toHaveBeenCalled(); // socket 時は REST を使わない
  });

  it('socket 未接続時は REST(api.sendMessage) に fallback + fetchMessages で手元反映', async () => {
    socketConnected = false;
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    fireEvent.click(screen.getByLabelText('記録のみ'));
    fireEvent.click(screen.getByRole('button', { name: '回答する' }));
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    const [rid, content, replyTo] = sendMessageMock.mock.calls[0];
    expect(rid).toBe('room1');
    expect(replyTo).toBe('form-msg-1');
    expect(content).toContain('笹沼さんは?: 記録のみ');
    expect(emitMock).not.toHaveBeenCalled();
    await waitFor(() => expect(fetchMessagesMock).toHaveBeenCalledWith('room1'));
  });

  it('★ 既に自分が回答済み(store に回答返信あり)なら「回答済み」表示で送信不可', () => {
    // リロード後や他端末でも、既存の回答返信から per-user の回答済みを導出しボタンを締める
    mockStore.messages = [
      { id: 'a1', reply_to: 'form-msg-1', sender_id: 'u1', content: '@cc-organon\n\n【回答】Day59 Q0\n笹沼さんは?: 記録のみ' },
    ];
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    const btn = screen.getByRole('button', { name: '回答済み' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('他人の回答返信では自分のボタンは締まらない (per-user)', () => {
    mockStore.messages = [
      { id: 'a2', reply_to: 'form-msg-1', sender_id: 'u2', content: '@cc-organon\n\n【回答】Day59 Q0\n笹沼さんは?: 記録のみ' },
    ];
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    expect(screen.getByRole('button', { name: '回答する' })).toBeTruthy();
  });

  it('送信後はボタンが「回答済み」になり再送信しない', async () => {
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    fireEvent.click(screen.getByLabelText('記録のみ'));
    fireEvent.click(screen.getByRole('button', { name: '回答する' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '回答済み' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '回答済み' }));
    expect(emitMock).toHaveBeenCalledTimes(1); // 増えない
  });

  // ── 畳み込み ──────────────────────────────────────────────
  // Q0 のような長いフォームが流れを占有するため、タイトルだけ残して畳めるようにする。
  // ★ 回答済みでも自動では畳まない: 既存の「回答済みで送信不可」の可視性を壊さないため。

  it('★ 畳むと本文(intro/フィールド/送信ボタン)が消え、タイトルは残る', () => {
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    expect(screen.getByText('笹沼さんは?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '折りたたむ' }));

    expect(screen.queryByText('笹沼さんは?')).toBeNull();
    expect(screen.queryByRole('button', { name: '回答する' })).toBeNull();
    expect(screen.getByText(/Day59 Q0/)).toBeTruthy(); // タイトルは残る = 何のフォームか分かる
  });

  it('畳んだあと展開すると元に戻る', () => {
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    fireEvent.click(screen.getByRole('button', { name: '折りたたむ' }));
    fireEvent.click(screen.getByRole('button', { name: '展開する' }));
    expect(screen.getByText('笹沼さんは?')).toBeTruthy();
    expect(screen.getByRole('button', { name: '回答する' })).toBeTruthy();
  });

  it('畳んでも入力中の値は失われない', () => {
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    fireEvent.click(screen.getByLabelText('記録のみ'));
    fireEvent.click(screen.getByRole('button', { name: '折りたたむ' }));
    fireEvent.click(screen.getByRole('button', { name: '展開する' }));
    expect((screen.getByLabelText('記録のみ') as HTMLInputElement).checked).toBe(true);
  });

  // ── 横拡張 ────────────────────────────────────────────────
  // ★ 幅の仕組みは新設しない。bubble の既存 expanded (.bubble-content-row 80%→100%) を
  //   そのまま使う。FormBubble は onDoubleClick を stopPropagation しているため
  //   (フォーム操作の誤爆防止)、既存のダブルクリック経路だけが届かない。明示の操作子で補う。

  it('★ 横拡張ボタンは onToggleExpand を呼ぶ (bubble 側の expanded を使い回す)', () => {
    const onToggleExpand = vi.fn();
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" onToggleExpand={onToggleExpand} />);
    fireEvent.click(screen.getByRole('button', { name: '横に広げる' }));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it('expanded=true のときはラベルが「幅を戻す」になる', () => {
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" expanded onToggleExpand={vi.fn()} />);
    expect(screen.getByRole('button', { name: '幅を戻す' })).toBeTruthy();
  });

  it('onToggleExpand が無ければ横拡張ボタンは出さない', () => {
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    expect(screen.queryByRole('button', { name: '横に広げる' })).toBeNull();
  });

  it('横拡張ボタンのクリックは bubble へ伝播しない (ダブルクリック誤爆防止と同じ理由)', () => {
    const onToggleExpand = vi.fn();
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <FormBubble message={MSG} schema={SCHEMA} roomId="room1" onToggleExpand={onToggleExpand} />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: '横に広げる' }));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
