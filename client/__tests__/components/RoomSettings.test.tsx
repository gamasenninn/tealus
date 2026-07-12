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

vi.mock('../../src/services/api', () => ({
  api: {
    getRoomAgentSettings: vi.fn(() => Promise.resolve({ settings: { response_mode: 'auto', enabled: true } })),
    updateRoomAgentSettings: vi.fn(() => Promise.resolve({ success: true })),
    getRoomLightPrompt: vi.fn(() => Promise.resolve({ content: 'light prompt content' })),
    updateRoomLightPrompt: vi.fn(() => Promise.resolve({ success: true })),
    getRoomClaudeMd: vi.fn(() => Promise.resolve({ content: 'claude md content' })),
    updateRoomClaudeMd: vi.fn(() => Promise.resolve({ success: true })),
    updateRoom: vi.fn(() => Promise.resolve()),
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
        currentRoom={{ type: 'direct' }}
        isAdmin={false}
        isSysAdmin={false}
      />);
      expect(await screen.findByText('エージェント設定')).toBeInTheDocument();
    });

    it('グループ + isAdmin では「エージェント設定」section が表示される', async () => {
      render(<RoomSettings
        {...baseProps}
        currentRoom={{ type: 'group' }}
        isAdmin={true}
        isSysAdmin={false}
      />);
      expect(await screen.findByText('エージェント設定')).toBeInTheDocument();
    });

    it('グループ + non-admin では「エージェント設定」section が表示されない', async () => {
      render(<RoomSettings
        {...baseProps}
        currentRoom={{ type: 'group' }}
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
        currentRoom={{ type: 'direct' }}
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
        currentRoom={{ type: 'group' }}
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
        currentRoom={{ type: 'direct' }}
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
        currentRoom={{ type: 'direct' }}
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
        currentRoom={{ type: 'direct' }}
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
