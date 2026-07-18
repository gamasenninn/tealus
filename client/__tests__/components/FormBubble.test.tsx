import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FormSchema, Message } from '../../src/types';

// api / socket / messageStore をモック (送信検証用)
const requestMock = vi.fn().mockResolvedValue({});
vi.mock('../../src/services/api', () => ({ api: { request: (...a: unknown[]) => requestMock(...a) } }));
const emitMock = vi.fn();
let socketConnected = true;
vi.mock('../../src/services/socket', () => ({
  getSocket: () => ({ get connected() { return socketConnected; }, emit: (...a: unknown[]) => emitMock(...a) }),
}));
const fetchMessagesMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/stores/messageStore', () => ({
  useMessageStore: { getState: () => ({ fetchMessages: fetchMessagesMock }) },
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
  beforeEach(() => { requestMock.mockClear(); fetchMessagesMock.mockClear(); emitMock.mockClear(); socketConnected = true; });

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

  it('socket 未接続時は REST に fallback (type=text + reply_to)', async () => {
    socketConnected = false;
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    fireEvent.click(screen.getByLabelText('記録のみ'));
    fireEvent.click(screen.getByRole('button', { name: '回答する' }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const [method, path, body] = requestMock.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/rooms/room1/messages');
    expect(body.type).toBe('text');
    expect(body.reply_to).toBe('form-msg-1');
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('送信後はボタンが「回答済み」になり再送信しない', async () => {
    render(<FormBubble message={MSG} schema={SCHEMA} roomId="room1" />);
    fireEvent.click(screen.getByLabelText('記録のみ'));
    fireEvent.click(screen.getByRole('button', { name: '回答する' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '回答済み' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '回答済み' }));
    expect(emitMock).toHaveBeenCalledTimes(1); // 増えない
  });
});
