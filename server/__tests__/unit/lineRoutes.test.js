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
const mockPostLocation = jest.fn(() => Promise.resolve({ message: { id: 'msg-location' } }));

jest.mock('../../src/services/lineMessageBridge', () => ({
  postTextToTealus: (...args) => mockPostText(...args),
  postImageToTealus: (...args) => mockPostImage(...args),
  postVoiceToTealus: (...args) => mockPostVoice(...args),
  postFileToTealus: (...args) => mockPostFile(...args),
  postVideoToTealus: (...args) => mockPostVideo(...args),
  postLocationToTealus: (...args) => mockPostLocation(...args),
}));

const mockFetchContent = jest.fn();
const mockFetchStickerImage = jest.fn();
const mockSaveContent = jest.fn();

jest.mock('../../src/services/lineBridge', () => ({
  fetchLineContent: (...args) => mockFetchContent(...args),
  fetchLineStickerImage: (...args) => mockFetchStickerImage(...args),
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

const TEST_CONFIG = {
  groupToRoomMap: { 'group-X': 'room-X', 'group-Y': 'room-Y' },
  botUserId: 'bot-user-uuid',
  channelToken: 'channel-token-xyz',
  mediaRoot: '/tmp/media-test',
};

let origCatalogEnv;
let tmpCatalog;
let tmpDir;

beforeEach(() => {
  mockPostText.mockClear();
  mockPostImage.mockClear();
  mockPostVoice.mockClear();
  mockPostFile.mockClear();
  mockPostVideo.mockClear();
  mockPostLocation.mockClear();
  mockFetchContent.mockReset();
  mockFetchStickerImage.mockReset();
  mockSaveContent.mockReset();
  // ★ ★ 本番 catalog file 上書き防止 (= memory feedback_test_file_guard.md 適用)
  // skipCatalog: true で catalog upsert は呼ばれないが、念のため env override で safety net
  tmpDir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'line-routes-test-'));
  tmpCatalog = require('path').join(tmpDir, 'catalog.json');
  origCatalogEnv = process.env.LINE_GROUP_CATALOG_FILE;
  process.env.LINE_GROUP_CATALOG_FILE = tmpCatalog;
});

afterEach(() => {
  try { require('fs').rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  if (origCatalogEnv === undefined) delete process.env.LINE_GROUP_CATALOG_FILE;
  else process.env.LINE_GROUP_CATALOG_FILE = origCatalogEnv;
});

describe('dispatchEvent', () => {
  test('text message → postTextToTealus', async () => {
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'text', id: 'm1', text: 'hello' },
    };
    const result = await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });

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
    const result = await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });

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
    const result = await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });

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
    const result = await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });
    expect(result).toEqual({ skipped: 'unmapped-group' });
    expect(mockPostText).not.toHaveBeenCalled();
  });

  test('non-group source (= 1:1 chat) → skip', async () => {
    const event = {
      type: 'message',
      source: { type: 'user', userId: 'U123' },
      message: { type: 'text', text: 'dm' },
    };
    const result = await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });
    expect(result).toEqual({ skipped: 'not-group' });
  });

  test('non-message event (= follow / unfollow 等) → skip', async () => {
    const event = { type: 'follow', source: { type: 'group', groupId: 'group-X' } };
    const result = await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });
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
    const result = await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });

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
    const result = await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });

    expect(result).toEqual({ posted: 'video' });
    expect(mockFetchContent).toHaveBeenCalledWith('m-vid', 'channel-token-xyz');
    expect(mockSaveContent).toHaveBeenCalledWith(expect.any(Buffer), 'video/mp4', '/tmp/media-test', { subdir: 'line-videos' });
    expect(mockPostVideo).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room-Y',
      senderUserId: 'bot-user-uuid',
      mediaInfo: expect.objectContaining({ relativePath: 'line-videos/clip.mp4' }),
    }));
  });

  test('sticker message → fetchLineStickerImage (= LINE sticker CDN) + saveLineContentToFile(subdir=line-stickers) + postImageToTealus (= Phase 2.2、image type 流用)', async () => {
    // ★ sticker は LINE Content API 非対応、★ LINE 公式 sticker CDN から直接 PNG fetch
    mockFetchStickerImage.mockResolvedValue({ buffer: Buffer.from('png-bytes'), mimeType: 'image/png' });
    mockSaveContent.mockResolvedValue({
      filePath: '/tmp/media-test/line-stickers/s.png',
      relativePath: 'line-stickers/s.png',
      fileName: 's.png',
      fileSize: 8,
      mimeType: 'image/png',
    });

    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'sticker', id: 'm-stk', packageId: '11537', stickerId: '52002734' },
    };
    const result = await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });

    expect(result).toEqual({ posted: 'sticker' });
    // ★ fetchLineContent ではなく fetchLineStickerImage が呼ばれる (= LINE 仕様)
    expect(mockFetchStickerImage).toHaveBeenCalledWith('52002734');
    expect(mockFetchContent).not.toHaveBeenCalled();
    expect(mockSaveContent).toHaveBeenCalledWith(expect.any(Buffer), 'image/png', '/tmp/media-test', { subdir: 'line-stickers' });
    expect(mockPostImage).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room-X',
      senderUserId: 'bot-user-uuid',
      mediaInfo: expect.objectContaining({ relativePath: 'line-stickers/s.png' }),
    }));
  });

  test('location message → postLocationToTealus (= 緯度経度 + 地図 link、Phase 2.2)', async () => {
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-Y' },
      message: { type: 'location', id: 'm-loc', title: '東京駅', address: '東京都千代田区', latitude: 35.6812, longitude: 139.7671 },
    };
    const result = await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });

    expect(result).toEqual({ posted: 'location' });
    expect(mockPostLocation).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room-Y',
      senderUserId: 'bot-user-uuid',
      location: expect.objectContaining({
        title: '東京駅',
        address: '東京都千代田区',
        latitude: 35.6812,
        longitude: 139.7671,
      }),
    }));
  });

  test('unsupported message type (= imagemap 等) → skip', async () => {
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'imagemap', id: 'im1' },
    };
    const result = await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });
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
    const result = await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });
    expect(result).toEqual({ skipped: 'no-message' });
  });
});

// loadGroupToRoomMap の test は 6/6 Day 21 で services/lineGroupMappings.js に移管
// (= 新 test: __tests__/unit/lineGroupMappings.test.js)
