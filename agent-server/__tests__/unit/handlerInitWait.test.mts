/**
 * #589 初期化がまだのときに届いた webhook を捨てない。
 * ★ 以前は dispatcher のガードで捨てていた (試し直しの待ち = 最長 60 秒の間に届いた投稿が失われる)。
 *   webhook が届いた = 本体は上がっているので、試し直しを起こし、つながるのを少し待ってから処理する
 */
jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
jest.mock('../../src/webhook/dispatcher.mts', () => ({ dispatch: jest.fn(async () => {}) }));
jest.mock('../../src/lib/botApi.mts', () => ({ getRooms: jest.fn(async () => ({ rooms: [] })), pushStatus: jest.fn(async () => ({})) }));
const mockKick = jest.fn();
let mockReady = false;
let mockInProgress = true;
jest.mock('../../src/lib/initGate.mts', () => ({
  kickInitRetry: () => mockKick(),
  whenAgentReady: jest.fn(async () => mockReady),
  isAgentReady: () => mockReady,
  isInitInProgress: () => mockInProgress,
}));

import { dispatch } from '../../src/webhook/dispatcher.mts';
import { handleWebhook, registerBotUserId } from '../../src/webhook/handler.mts';
import type { WebhookPayload } from '../../src/types.mts';

const payload = {
  event: 'message.created',
  message: { id: 'm1', content: '@アシスタント こんにちは', type: 'text', sender: { id: 'u1', display_name: '甲野' }, created_at: '2026-10-12T00:00:00Z' },
  room: { id: 'r1', name: '部屋' },
} as unknown as WebhookPayload;

describe('#589 初期化がまだのときに届いた webhook', () => {
  beforeEach(() => { jest.clearAllMocks(); mockReady = false; mockInProgress = true; });

  test('★ 試し直しを起こし、つながったらその投稿を Bot の ID つきで処理する', async () => {
    mockKick.mockImplementation(() => { registerBotUserId('bot-1', 'アシスタント', [{ id: 'r1' }]); mockReady = true; });
    await handleWebhook(payload);
    expect(mockKick).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'bot-1' }));
  });

  test('試し直しが走っていなければ (401 で止めた後など) 待たない', async () => {
    mockInProgress = false;
    await handleWebhook(payload);
    expect(mockKick).not.toHaveBeenCalled();
  });
});
