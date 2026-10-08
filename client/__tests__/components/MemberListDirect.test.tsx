/**
 * DM (1 対 1) のメニュー (2026-10-08)
 *
 * ★ それまで DM には ≡ が無く、「このルームの通知」(#463) も「音声の連続再生」も切り替えられなかった。
 * ★ DM ではメンバーの一覧・追加・退会・グループの名前とアイコン・管理者向けの設定は出さず、個人設定だけを出す
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/api', () => ({
  api: {
    setRoomNotification: vi.fn(() => Promise.resolve({ push_muted: true })),
    getRoomAgentSettings: vi.fn(() => Promise.resolve({ settings: { response_mode: 'auto', enabled: true } })),
    getRoomLightPrompt: vi.fn(() => Promise.resolve({ content: '' })),
    getRoomClaudeMd: vi.fn(() => Promise.resolve({ content: '' })),
    getTtsOptions: vi.fn(() => Promise.resolve(null)),
    getVoiceChatTools: vi.fn(() => Promise.resolve({ tools: [], default_denied: [], protected: [] })),
  },
}));

import MemberList from '../../src/components/chat/MemberList';
import { useAuthStore } from '../../src/stores/authStore';
import { useRoomStore } from '../../src/stores/roomStore';

function renderWith(type: 'direct' | 'group') {
  useRoomStore.setState({
    currentRoom: { id: 'room-1', type, name: type === 'group' ? 'グループ' : null },
    members: [
      { user_id: 'me', display_name: '私', role: 'admin' },
      { user_id: 'other', display_name: '相手', role: 'member' },
    ],
    selectRoom: vi.fn(),
  } as never);
  return render(<MemoryRouter><MemberList roomId="room-1" onClose={() => {}} /></MemoryRouter>);
}

describe('MemberList — DM では個人設定だけ', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'me', role: 'admin', display_name: '私' } } as never);
  });

  it('★ DM: 「このルームの通知」は出て、メンバー一覧・退会・管理者向けの設定は出ない', () => {
    renderWith('direct');
    expect(screen.getByLabelText('このルームの通知')).toBeInTheDocument();
    expect(screen.queryByText('メンバー一覧')).not.toBeInTheDocument();
    expect(screen.queryByText('このグループを退会')).not.toBeInTheDocument();
    expect(screen.queryByText('ルーム設定（管理者）')).not.toBeInTheDocument();
    expect(screen.queryByText('エージェント設定')).not.toBeInTheDocument();
  });

  it('グループ: これまでどおりメンバー一覧と退会が出る', () => {
    renderWith('group');
    expect(screen.getByText('メンバー一覧')).toBeInTheDocument();
    expect(screen.getByText('このグループを退会')).toBeInTheDocument();
    expect(screen.getByLabelText('このルームの通知')).toBeInTheDocument();
  });
});
