/**
 * routes/line.js dispatchEvent + loadGroupToRoomMap unit test
 *
 * router level (= express raw body + signature) は manual / integration test 段階に委ね、
 * 本 test は dispatchEvent の event 型別 dispatch + skip 条件を verify。
 */

// Mock dependencies
const mockPostText = jest.fn(() => Promise.resolve({ message: { id: 'msg-text' } }));
const mockPostImage = jest.fn(() => Promise.resolve({ message: { id: 'msg-image' } }));
const mockPostVoice = jest.fn(() => Promise.resolve({ message: { id: 'msg-voice' } }));
const mockPostFile = jest.fn(() => Promise.resolve({ message: { id: 'msg-file' } }));
const mockPostVideo = jest.fn(() => Promise.resolve({ message: { id: 'msg-video' } }));

jest.mock('../../src/services/lineMessageBridge', () => ({
  postTextToTealus: (...args) => mockPostText(...args),
  postImageToTealus: (...args) => mockPostImage(...args),
  postVoiceToTealus: (...args) => mockPostVoice(...args),
  postFileToTealus: (...args) => mockPostFile(...args),
  postVideoToTealus: (...args) => mockPostVideo(...args),
}));

const mockFetchContent = jest.fn();
const mockSaveContent = jest.fn();

jest.mock('../../src/services/lineBridge', () => ({
  fetchLineContent: (...args) => mockFetchContent(...args),
  saveLineContentToFile: (...args) => mockSaveContent(...args),
}));

jest.mock('../../src/services/lineSignature', () => ({
  verifyLineSignature: jest.fn(() => true),
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

const lineRouter = require('../../src/routes/line');
const dispatchEvent = lineRouter.dispatchEvent;
const loadGroupToRoomMap = lineRouter.loadGroupToRoomMap;

const TEST_CONFIG = {
  groupToRoomMap: { 'group-X': 'room-X', 'group-Y': 'room-Y' },
  botUserId: 'bot-user-uuid',
  channelToken: 'channel-token-xyz',
  mediaRoot: '/tmp/media-test',
};

beforeEach(() => {
  mockPostText.mockClear();
  mockPostImage.mockClear();
  mockPostVoice.mockClear();
  mockPostFile.mockClear();
  mockPostVideo.mockClear();
  mockFetchContent.mockReset();
  mockSaveContent.mockReset();
});

describe('dispatchEvent', () => {
  test('text message → postTextToTealus', async () => {
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'text', id: 'm1', text: 'hello' },
    };
    const result = await dispatchEvent(event, { config: TEST_CONFIG });

    expect(result).toEqual({ posted: 'text' });
    expect(mockPostText).toHaveBeenCalledWith({
      roomId: 'room-X',
      senderUserId: 'bot-user-uuid',
      content: 'hello',
      io: undefined,
    });
  });

  test('image message → fetchLineContent + saveLineContentToFile + postImageToTealus', async () => {
    mockFetchContent.mockResolvedValue({ buffer: Buffer.from('img-bytes'), mimeType: 'image/jpeg' });
    mockSaveContent.mockResolvedValue({
      filePath: '/tmp/media-test/line-images/x.jpg',
      relativePath: 'line-images/x.jpg',
      fileName: 'x.jpg',
      fileSize: 9,
      mimeType: 'image/jpeg',
    });

    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'image', id: 'm-img' },
    };
    const result = await dispatchEvent(event, { config: TEST_CONFIG });

    expect(result).toEqual({ posted: 'image' });
    expect(mockFetchContent).toHaveBeenCalledWith('m-img', 'channel-token-xyz');
    expect(mockSaveContent).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg', '/tmp/media-test', { subdir: 'line-images' });
    expect(mockPostImage).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room-X',
      senderUserId: 'bot-user-uuid',
      mediaInfo: expect.objectContaining({ relativePath: 'line-images/x.jpg' }),
    }));
  });

  test('audio message → fetchLineContent + saveLineContentToFile + postVoiceToTealus', async () => {
    mockFetchContent.mockResolvedValue({ buffer: Buffer.from('m4a-bytes'), mimeType: 'audio/m4a' });
    mockSaveContent.mockResolvedValue({
      filePath: '/tmp/media-test/line-voices/v.m4a',
      relativePath: 'line-voices/v.m4a',
      fileName: 'v.m4a',
      fileSize: 9,
      mimeType: 'audio/m4a',
    });

    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-Y' },
      message: { type: 'audio', id: 'm-aud' },
    };
    const result = await dispatchEvent(event, { config: TEST_CONFIG });

    expect(result).toEqual({ posted: 'voice' });
    expect(mockFetchContent).toHaveBeenCalledWith('m-aud', 'channel-token-xyz');
    expect(mockSaveContent).toHaveBeenCalledWith(expect.any(Buffer), 'audio/m4a', '/tmp/media-test', { subdir: 'line-voices' });
    expect(mockPostVoice).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room-Y',
      senderUserId: 'bot-user-uuid',
      mediaInfo: expect.objectContaining({ relativePath: 'line-voices/v.m4a' }),
    }));
  });

  test('unmapped group → silent skip', async () => {
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'unmapped-group-Z' },
      message: { type: 'text', id: 'm1', text: 'hello' },
    };
    const result = await dispatchEvent(event, { config: TEST_CONFIG });
    expect(result).toEqual({ skipped: 'unmapped-group' });
    expect(mockPostText).not.toHaveBeenCalled();
  });

  test('non-group source (= 1:1 chat) → skip', async () => {
    const event = {
      type: 'message',
      source: { type: 'user', userId: 'U123' },
      message: { type: 'text', text: 'dm' },
    };
    const result = await dispatchEvent(event, { config: TEST_CONFIG });
    expect(result).toEqual({ skipped: 'not-group' });
  });

  test('non-message event (= follow / unfollow 等) → skip', async () => {
    const event = { type: 'follow', source: { type: 'group', groupId: 'group-X' } };
    const result = await dispatchEvent(event, { config: TEST_CONFIG });
    expect(result).toEqual({ skipped: 'not-message' });
  });

  test('file message → fetchLineContent + saveLineContentToFile + postFileToTealus (= Phase 2.1)', async () => {
    mockFetchContent.mockResolvedValue({ buffer: Buffer.from('pdf-bytes'), mimeType: 'application/pdf' });
    mockSaveContent.mockResolvedValue({
      filePath: '/tmp/media-test/line-files/doc.pdf',
      relativePath: 'line-files/doc.pdf',
      fileName: 'doc.pdf',
      fileSize: 2048,
      mimeType: 'application/pdf',
    });

    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'file', id: 'm-file', fileName: 'doc.pdf', fileSize: 2048 },
    };
    const result = await dispatchEvent(event, { config: TEST_CONFIG });

    expect(result).toEqual({ posted: 'file' });
    expect(mockFetchContent).toHaveBeenCalledWith('m-file', 'channel-token-xyz');
    // ★ originalFileName が webhook event.message.fileName から saveLineContentToFile に渡される
    expect(mockSaveContent).toHaveBeenCalledWith(expect.any(Buffer), 'application/pdf', '/tmp/media-test', {
      subdir: 'line-files',
      originalFileName: 'doc.pdf',
    });
    expect(mockPostFile).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room-X',
      senderUserId: 'bot-user-uuid',
      mediaInfo: expect.objectContaining({ relativePath: 'line-files/doc.pdf' }),
    }));
  });

  test('video message → fetchLineContent + saveLineContentToFile + postVideoToTealus (= Phase 2.1)', async () => {
    mockFetchContent.mockResolvedValue({ buffer: Buffer.from('mp4-bytes'), mimeType: 'video/mp4' });
    mockSaveContent.mockResolvedValue({
      filePath: '/tmp/media-test/line-videos/clip.mp4',
      relativePath: 'line-videos/clip.mp4',
      fileName: 'clip.mp4',
      fileSize: 102400,
      mimeType: 'video/mp4',
    });

    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-Y' },
      message: { type: 'video', id: 'm-vid' },
    };
    const result = await dispatchEvent(event, { config: TEST_CONFIG });

    expect(result).toEqual({ posted: 'video' });
    expect(mockFetchContent).toHaveBeenCalledWith('m-vid', 'channel-token-xyz');
    expect(mockSaveContent).toHaveBeenCalledWith(expect.any(Buffer), 'video/mp4', '/tmp/media-test', { subdir: 'line-videos' });
    expect(mockPostVideo).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room-Y',
      senderUserId: 'bot-user-uuid',
      mediaInfo: expect.objectContaining({ relativePath: 'line-videos/clip.mp4' }),
    }));
  });

  test('unsupported message type (= sticker / location 等) → skip', async () => {
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'sticker', id: 's1' },
    };
    const result = await dispatchEvent(event, { config: TEST_CONFIG });
    expect(result.skipped).toMatch(/^unsupported-type-/);
  });

  test('botUserId 未設定で skip', async () => {
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'text', text: 'x' },
    };
    const config = { ...TEST_CONFIG, botUserId: undefined };
    const result = await dispatchEvent(event, { config });
    expect(result).toEqual({ skipped: 'no-bot-user' });
    expect(mockPostText).not.toHaveBeenCalled();
  });

  test('message null → skip', async () => {
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      // message なし
    };
    const result = await dispatchEvent(event, { config: TEST_CONFIG });
    expect(result).toEqual({ skipped: 'no-message' });
  });
});

describe('loadGroupToRoomMap', () => {
  const orig = process.env.LINE_GROUP_TO_ROOM;
  afterEach(() => {
    if (orig === undefined) delete process.env.LINE_GROUP_TO_ROOM;
    else process.env.LINE_GROUP_TO_ROOM = orig;
  });

  test('有効 JSON → object', () => {
    process.env.LINE_GROUP_TO_ROOM = '{"g1":"r1","g2":"r2"}';
    expect(loadGroupToRoomMap()).toEqual({ g1: 'r1', g2: 'r2' });
  });

  test('invalid JSON → 空 object (= silent fallback、startup 阻害しない)', () => {
    process.env.LINE_GROUP_TO_ROOM = 'not json';
    expect(loadGroupToRoomMap()).toEqual({});
  });

  test('未設定 → 空 object', () => {
    delete process.env.LINE_GROUP_TO_ROOM;
    expect(loadGroupToRoomMap()).toEqual({});
  });
});
