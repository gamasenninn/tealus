/**
 * RoomSettings component の test (#156)
 *
 * 役割:
 * - 「エージェント設定」section の権限ロジック (DM / グループ + admin / グループ + non-admin)
 * - mount 時に agent-server settings endpoint 3 種 (response_mode / light-prompt / claude-md) を fetch
 * - 応答モード select 変更で updateRoomAgentSettings を呼ぶ
 *
 * 既存 section (個人設定 / ルーム設定 (admin) / システム設定 (sysAdmin)) は本 test では touch しない。
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RoomSettings from '../../src/components/chat/RoomSettings';
import type { Room } from '../../src/types';

vi.mock('../../src/services/api', () => ({
  api: {
    getRoomAgentSettings: vi.fn(() => Promise.resolve({ settings: { response_mode: 'auto', enabled: true } })),
    updateRoomAgentSettings: vi.fn(() => Promise.resolve({ success: true })),
    getRoomLightPrompt: vi.fn(() => Promise.resolve({ content: 'light prompt content' })),
    updateRoomLightPrompt: vi.fn(() => Promise.resolve({ success: true })),
    getRoomClaudeMd: vi.fn(() => Promise.resolve({ content: 'claude md content' })),
    updateRoomClaudeMd: vi.fn(() => Promise.resolve({ success: true })),
    updateRoom: vi.fn(() => Promise.resolve()),
    // #418 会話モードの道具の一覧 (docs/08 §12.17)
    getVoiceChatTools: vi.fn(() => Promise.resolve({
      tools: [
        { name: 'get_messages', description: '履歴を引く' },
        { name: 'execute_sql', description: '社内DB' },
        { name: 'send_message', description: '送信' },
        { name: 'write_file', description: 'ファイルを書く' },
      ],
      default_denied: ['delete_room', 'create_room', 'write_file', 'edit_file', 'move_file'],
      protected: ['send_message'],
    })),
  },
}));

const { api } = await import('../../src/services/api');

const baseProps = {
  roomId: 'room-1',
  selectRoom: vi.fn(),
};

describe('RoomSettings — エージェント設定 section (#156)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('権限ロジック', () => {
    it('DM (type=direct) では「エージェント設定」section が表示される', async () => {
      render(<RoomSettings
        {...baseProps}
        currentRoom={{ type: 'direct' } as Room}
        isAdmin={false}
        isSysAdmin={false}
      />);
      expect(await screen.findByText('エージェント設定')).toBeInTheDocument();
    });

    it('グループ + isAdmin では「エージェント設定」section が表示される', async () => {
      render(<RoomSettings
        {...baseProps}
        currentRoom={{ type: 'group' } as Room}
        isAdmin={true}
        isSysAdmin={false}
      />);
      expect(await screen.findByText('エージェント設定')).toBeInTheDocument();
    });

    it('グループ + non-admin では「エージェント設定」section が表示されない', async () => {
      render(<RoomSettings
        {...baseProps}
        currentRoom={{ type: 'group' } as Room}
        isAdmin={false}
        isSysAdmin={false}
      />);
      // 既存 section (個人設定) は出るが、エージェント設定は出ない
      expect(screen.queryByText('エージェント設定')).not.toBeInTheDocument();
    });
  });

  describe('mount 時の初期 load', () => {
    it('canEdit=true の時、3 endpoint を並列で fetch する', async () => {
      render(<RoomSettings
        {...baseProps}
        currentRoom={{ type: 'direct' } as Room}
        isAdmin={false}
        isSysAdmin={false}
      />);
      await waitFor(() => {
        expect(api.getRoomAgentSettings).toHaveBeenCalledWith('room-1');
        expect(api.getRoomLightPrompt).toHaveBeenCalledWith('room-1');
        expect(api.getRoomClaudeMd).toHaveBeenCalledWith('room-1');
      });
    });

    it('canEdit=false の時、agent-server endpoint は fetch しない', async () => {
      render(<RoomSettings
        {...baseProps}
        currentRoom={{ type: 'group' } as Room}
        isAdmin={false}
        isSysAdmin={false}
      />);
      // ちょっと待ってから call されないことを確認
      await new Promise((r) => setTimeout(r, 30));
      expect(api.getRoomAgentSettings).not.toHaveBeenCalled();
      expect(api.getRoomLightPrompt).not.toHaveBeenCalled();
      expect(api.getRoomClaudeMd).not.toHaveBeenCalled();
    });
  });

  describe('応答モードの変更', () => {
    it('select 変更で updateRoomAgentSettings が呼ばれる', async () => {
      render(<RoomSettings
        {...baseProps}
        currentRoom={{ type: 'direct' } as Room}
        isAdmin={false}
        isSysAdmin={false}
      />);
      const select = await screen.findByLabelText('応答モード');
      fireEvent.change(select, { target: { value: 'mention' } });
      await waitFor(() => {
        expect(api.updateRoomAgentSettings).toHaveBeenCalledWith(
          'room-1',
          expect.objectContaining({ response_mode: 'mention' }),
        );
      });
    });
  });

  describe('プロンプトの保存', () => {
    it('Light Agent プロンプト textarea を blur すると updateRoomLightPrompt が呼ばれる', async () => {
      render(<RoomSettings
        {...baseProps}
        currentRoom={{ type: 'direct' } as Room}
        isAdmin={false}
        isSysAdmin={false}
      />);
      const textarea = await screen.findByLabelText('Light Agent プロンプト');
      fireEvent.change(textarea, { target: { value: 'new light prompt' } });
      fireEvent.blur(textarea);
      await waitFor(() => {
        expect(api.updateRoomLightPrompt).toHaveBeenCalledWith('room-1', 'new light prompt');
      });
    });

    it('Deep Agent プロンプト textarea を blur すると updateRoomClaudeMd が呼ばれる', async () => {
      render(<RoomSettings
        {...baseProps}
        currentRoom={{ type: 'direct' } as Room}
        isAdmin={false}
        isSysAdmin={false}
      />);
      const textarea = await screen.findByLabelText('Deep Agent プロンプト');
      fireEvent.change(textarea, { target: { value: 'new deep prompt' } });
      fireEvent.blur(textarea);
      await waitFor(() => {
        expect(api.updateRoomClaudeMd).toHaveBeenCalledWith('room-1', 'new deep prompt');
      });
    });
  });
});

/**
 * #418 ★ 会話モードの道具を「既定で全許可 + 外す」にした (docs/08 §12.17)。
 *
 * ★ 旧: カンマ区切りのテキスト入力に**足す道具の名前を書く**。
 *   → 管理者が名前を知る手段が起動ログしか無く、負荷が高かった (利用者指摘)。
 * ★★ 新: **一覧をサーバから取ってきてチェックを外す**。checked = 許可。
 */
describe('RoomSettings — 会話モードの道具 (#418)', () => {
  const voiceRoom = {
    id: 'room-1', name: '営業報告', type: 'group',
    voice_conversation_enabled: true,
  } as unknown as Room;

  beforeEach(() => { vi.clearAllMocks(); });

  it('★ 会話モードが開いているときだけ 一覧を取りに行く', async () => {
    render(<RoomSettings {...baseProps} currentRoom={voiceRoom} isAdmin={true} isSysAdmin={false} />);
    await waitFor(() => expect(api.getVoiceChatTools).toHaveBeenCalledWith('room-1'));
  });

  it('★ 開いていないルームでは 取りに行かない (MCP を温めない)', async () => {
    const off = { ...voiceRoom, voice_conversation_enabled: false } as Room;
    render(<RoomSettings {...baseProps} currentRoom={off} isAdmin={true} isSysAdmin={false} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(api.getVoiceChatTools).not.toHaveBeenCalled();
  });

  it('★★ 取得中は そう分かる文言を出す (数十秒かかることがある)', async () => {
    render(<RoomSettings {...baseProps} currentRoom={voiceRoom} isAdmin={true} isSysAdmin={false} />);
    expect(screen.getByText(/取得しています/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/get_messages/)).toBeInTheDocument());
  });

  it('★★ 既定では 消す系だけ外れている (それ以外は許可)', async () => {
    render(<RoomSettings {...baseProps} currentRoom={voiceRoom} isAdmin={true} isSysAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText(/execute_sql/)).toBeInTheDocument());

    expect(screen.getByLabelText(/execute_sql/)).toBeChecked();
    expect(screen.getByLabelText(/get_messages/)).toBeChecked();
    expect(screen.getByLabelText(/write_file/)).not.toBeChecked();   // ★ 消す系は既定で外れる
  });

  it('★★ チェックを外すと 外す道具として保存される', async () => {
    render(<RoomSettings {...baseProps} currentRoom={voiceRoom} isAdmin={true} isSysAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText(/execute_sql/)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/execute_sql/));

    await waitFor(() => expect(api.updateRoom).toHaveBeenCalledWith('room-1', expect.objectContaining({
      voice_conversation_denied_tools: ['execute_sql'],
    })));
  });

  it('★★ 消す系にチェックを入れると 戻す道具として保存される', async () => {
    render(<RoomSettings {...baseProps} currentRoom={voiceRoom} isAdmin={true} isSysAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText(/write_file/)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/write_file/));

    await waitFor(() => expect(api.updateRoom).toHaveBeenCalledWith('room-1', expect.objectContaining({
      voice_conversation_tools: ['write_file'],
    })));
  });

  it('★★★ send_message は外せない (昇格に要るため)', async () => {
    render(<RoomSettings {...baseProps} currentRoom={voiceRoom} isAdmin={true} isSysAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText(/send_message/)).toBeInTheDocument());

    expect(screen.getByLabelText(/send_message/)).toBeDisabled();
    expect(screen.getByLabelText(/send_message/)).toBeChecked();
  });

  it('★★ 消す系を戻すときは 何が起きるかを画面に書く', async () => {
    render(<RoomSettings {...baseProps} currentRoom={voiceRoom} isAdmin={true} isSysAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText(/write_file/)).toBeInTheDocument());
    // ★ 「このルームの設定ファイルも書き換えられる」ことを、戻す前に読める場所に置く
    expect(screen.getByText(/設定ファイル/)).toBeInTheDocument();
  });

  it('★ 取得に失敗したら 理由と やり直しを出す', async () => {
    vi.mocked(api.getVoiceChatTools).mockRejectedValueOnce(new Error('繋がりません'));
    render(<RoomSettings {...baseProps} currentRoom={voiceRoom} isAdmin={true} isSysAdmin={false} />);

    await waitFor(() => expect(screen.getByText(/やり直す/)).toBeInTheDocument());
  });
});
