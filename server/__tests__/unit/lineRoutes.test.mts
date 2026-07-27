/**
 * routes/line.js dispatchEvent + loadGroupToRoomMap unit test
 *
 * router level (= express raw body + signature) は manual / integration test 段階に委ね、
 * 本 test は dispatchEvent の event 型別 dispatch + skip 条件を verify。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock dependencies
const mockPostText = jest.fn((..._args: unknown[]) => Promise.resolve({ message: { id: 'msg-text' } }));
const mockPostImage = jest.fn((..._args: unknown[]) => Promise.resolve({ message: { id: 'msg-image' } }));
const mockPostImages = jest.fn((..._args: unknown[]) => Promise.resolve({ message: { id: 'msg-image-set' } }));
const mockPostVoice = jest.fn((..._args: unknown[]) => Promise.resolve({ message: { id: 'msg-voice' } }));
const mockPostFile = jest.fn((..._args: unknown[]) => Promise.resolve({ message: { id: 'msg-file' } }));
const mockPostVideo = jest.fn((..._args: unknown[]) => Promise.resolve({ message: { id: 'msg-video' } }));
const mockPostLocation = jest.fn((..._args: unknown[]) => Promise.resolve({ message: { id: 'msg-location' } }));

jest.mock('../../src/services/lineMessageBridge.mts', () => ({
  postTextToTealus: (...args: unknown[]) => mockPostText(...args),
  postImageToTealus: (...args: unknown[]) => mockPostImage(...args),
  postImagesToTealus: (...args: unknown[]) => mockPostImages(...args),
  postVoiceToTealus: (...args: unknown[]) => mockPostVoice(...args),
  postFileToTealus: (...args: unknown[]) => mockPostFile(...args),
  postVideoToTealus: (...args: unknown[]) => mockPostVideo(...args),
  postLocationToTealus: (...args: unknown[]) => mockPostLocation(...args),
}));

const mockFetchContent = jest.fn();
const mockFetchStickerImage = jest.fn();
const mockSaveContent = jest.fn();

jest.mock('../../src/services/lineBridge.mts', () => ({
  fetchLineContent: (...args: unknown[]) => mockFetchContent(...args),
  fetchLineStickerImage: (...args: unknown[]) => mockFetchStickerImage(...args),
  saveLineContentToFile: (...args: unknown[]) => mockSaveContent(...args),
}));

// ★ Option D: pool mock (= bot user fetch path、cfg.sender 経由でない default 経路 test 用)
const mockPoolQuery = jest.fn();
jest.mock('../../src/db/pool.mts', () => ({ pool: {
  query: (...args: unknown[]) => mockPoolQuery(...args),
  connect: jest.fn(),  // ★ helper test では mockClient 経由で別 mock、router test では未使用
} }));

jest.mock('../../src/services/lineSignature.mts', () => ({
  verifyLineSignature: jest.fn(() => true),
}));

jest.mock('../../src/utils/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} }));

import { dispatchEvent } from '../../src/routes/line.mts';
import type { LineSenderContext } from '../../src/services/lineMessageBridge.mts';

// ★ Option D (= Day 21 PM): cfg.sender で test 用に直接 sender object 渡し (= pool query bypass)
const TEST_SENDER: LineSenderContext = { id: 'bot-user-uuid', display_name: 'LINE Bridge', avatar_url: 'avatars/line.png' };
const TEST_CONFIG = {
  groupToRoomMap: { 'group-X': 'room-X', 'group-Y': 'room-Y' },
  botUserId: 'bot-user-uuid',
  channelToken: 'channel-token-xyz',
  mediaRoot: '/tmp/media-test',
  sender: TEST_SENDER,  // ★ Option D test override
};

let origCatalogEnv: string | undefined;
let tmpCatalog: string;
let tmpDir: string;

beforeEach(() => {
  mockPostText.mockClear();
  mockPostImage.mockClear();
  mockPostImages.mockClear();
  mockPostVoice.mockClear();
  mockPostFile.mockClear();
  mockPostVideo.mockClear();
  mockPostLocation.mockClear();
  mockFetchContent.mockReset();
  mockFetchStickerImage.mockReset();
  mockSaveContent.mockReset();
  mockPoolQuery.mockReset();
  // ★ ★ 本番 catalog file 上書き防止 (= memory feedback_test_file_guard.md 適用)
  // skipCatalog: true で catalog upsert は呼ばれないが、念のため env override で safety net
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-routes-test-'));
  tmpCatalog = path.join(tmpDir, 'catalog.json');
  origCatalogEnv = process.env.LINE_GROUP_CATALOG_FILE;
  process.env.LINE_GROUP_CATALOG_FILE = tmpCatalog;
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
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
      sender: TEST_SENDER,
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
      sender: TEST_SENDER,
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
      sender: TEST_SENDER,
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
    const result = await dispatchEvent(event as Parameters<typeof dispatchEvent>[0], { config: { ...TEST_CONFIG, skipCatalog: true } });
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
      sender: TEST_SENDER,
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
      sender: TEST_SENDER,
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
      sender: TEST_SENDER,
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
      sender: TEST_SENDER,
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
    const result = await dispatchEvent(event as Parameters<typeof dispatchEvent>[0], { config });
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

  test('bot user not found → skip (= Option D、Day 21 PM)', async () => {
    // ★ cfg.sender なし → pool.query 経路、empty rows で skip
    mockPoolQuery.mockResolvedValue({ rows: [] });
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'text', text: 'x' },
    };
    const config = { ...TEST_CONFIG, skipCatalog: true, sender: undefined };
    const result = await dispatchEvent(event as Parameters<typeof dispatchEvent>[0], { config });
    expect(result).toEqual({ skipped: 'bot-user-not-found' });
    expect(mockPostText).not.toHaveBeenCalled();
  });

  test('bot user fetch error → skip (= Option D、pool query throw)', async () => {
    mockPoolQuery.mockRejectedValue(new Error('DB down'));
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'text', text: 'x' },
    };
    const config = { ...TEST_CONFIG, skipCatalog: true, sender: undefined };
    const result = await dispatchEvent(event as Parameters<typeof dispatchEvent>[0], { config });
    expect(result).toEqual({ skipped: 'bot-user-fetch-error' });
    expect(mockPostText).not.toHaveBeenCalled();
  });

  test('cfg.sender なし + bot user 存在 → pool.query 経路で sender 取得 (= Option D default 経路)', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{ id: 'bot-user-uuid', display_name: 'LINE Bridge', avatar_url: 'avatars/line.png' }],
    });
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'text', text: 'hello' },
    };
    const config = { ...TEST_CONFIG, skipCatalog: true, sender: undefined };
    const result = await dispatchEvent(event as Parameters<typeof dispatchEvent>[0], { config });
    expect(result).toEqual({ posted: 'text' });
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, display_name, avatar_url FROM users'),
      ['bot-user-uuid']
    );
    expect(mockPostText).toHaveBeenCalledWith(expect.objectContaining({
      sender: expect.objectContaining({ id: 'bot-user-uuid', display_name: 'LINE Bridge' }),
    }));
  });
});

describe('dispatchEvent — sender label (#309 案A)', () => {
  let origMemberEnv: string | undefined;
  beforeEach(() => {
    origMemberEnv = process.env.LINE_MEMBER_CATALOG_FILE;
    process.env.LINE_MEMBER_CATALOG_FILE = path.join(tmpDir, 'members.json');
  });
  afterEach(() => {
    if (origMemberEnv === undefined) delete process.env.LINE_MEMBER_CATALOG_FILE;
    else process.env.LINE_MEMBER_CATALOG_FILE = origMemberEnv;
  });

  test('cfg.senderLabel 指定 → text content に **ラベル** prefix', async () => {
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X', userId: 'U1' },
      message: { type: 'text', id: 'm1', text: 'hello' },
    };
    await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true, senderLabel: '小野仙人@営業' } });
    expect(mockPostText).toHaveBeenCalledWith(expect.objectContaining({
      content: '[小野仙人@営業]\nhello',
    }));
  });

  test('cfg.senderLabel + image → caption に **ラベル**', async () => {
    mockFetchContent.mockResolvedValue({ buffer: Buffer.from('x'), mimeType: 'image/jpeg' });
    mockSaveContent.mockResolvedValue({ relativePath: 'line-images/x.jpg', fileName: 'x.jpg', fileSize: 1, mimeType: 'image/jpeg' });
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X', userId: 'U1' },
      message: { type: 'image', id: 'mi' },
    };
    await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true, senderLabel: '小野仙人@営業' } });
    expect(mockPostImage).toHaveBeenCalledWith(expect.objectContaining({ content: '[小野仙人@営業]' }));
  });

  test('cfg.senderLabel + voice → content に **ラベル**', async () => {
    mockFetchContent.mockResolvedValue({ buffer: Buffer.from('x'), mimeType: 'audio/m4a' });
    mockSaveContent.mockResolvedValue({ relativePath: 'line-voices/x.m4a', fileName: 'x.m4a', fileSize: 1, mimeType: 'audio/m4a' });
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X', userId: 'U1' },
      message: { type: 'audio', id: 'ma' },
    };
    await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true, senderLabel: '小野仙人@営業' } });
    expect(mockPostVoice).toHaveBeenCalledWith(expect.objectContaining({ content: '[小野仙人@営業]' }));
  });

  test('cfg.senderLabel + location → postLocation に senderLabel 渡る', async () => {
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X', userId: 'U1' },
      message: { type: 'location', title: '東京駅', latitude: 35.68, longitude: 139.76 },
    };
    await dispatchEvent(event as Parameters<typeof dispatchEvent>[0], { config: { ...TEST_CONFIG, skipCatalog: true, senderLabel: '小野仙人@営業' } });
    expect(mockPostLocation).toHaveBeenCalledWith(expect.objectContaining({ senderLabel: '小野仙人@営業' }));
  });

  test('実解決: userId + memberFetchImpl + group catalog name → 「氏名@グループ名」', async () => {
    fs.writeFileSync(tmpCatalog, JSON.stringify({ 'group-X': { name: '営業部LINE' } }));
    const memberFetchImpl = jest.fn(async () => ({
      ok: true, status: 200, statusText: 'OK', json: async () => ({ displayName: '小野仙人' }),
    } as unknown as Response));
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X', userId: 'U1' },
      message: { type: 'text', id: 'm1', text: 'やあ' },
    };
    await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true, memberFetchImpl } });
    expect(memberFetchImpl).toHaveBeenCalled();
    expect(mockPostText).toHaveBeenCalledWith(expect.objectContaining({
      content: '[小野仙人@営業部LINE]\nやあ',
    }));
  });

  test('userId 無し → ラベルなし (= 従来どおり、content 素のまま)', async () => {
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'text', id: 'm1', text: 'hello' },
    };
    await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });
    expect(mockPostText).toHaveBeenCalledWith(expect.objectContaining({ content: 'hello' }));
  });

  test('member fetch 失敗 → ラベルなし degrade (content 素のまま)', async () => {
    const memberFetchImpl = jest.fn(async () => ({ ok: false, status: 403, statusText: 'Forbidden', json: async () => ({}) } as unknown as Response));
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X', userId: 'U1' },
      message: { type: 'text', id: 'm1', text: 'hello' },
    };
    await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true, memberFetchImpl } });
    expect(mockPostText).toHaveBeenCalledWith(expect.objectContaining({ content: 'hello' }));
  });
});

// loadGroupToRoomMap の test は 6/6 Day 21 で services/lineGroupMappings.js に移管
// (= 新 test: __tests__/unit/lineGroupMappings.test.js)

// ============================================
// imageSet (#353) — 複数画像同時送信の束ね
// ============================================
describe('dispatchEvent imageSet', () => {
  const flushTick = () => new Promise((r) => setTimeout(r, 10));

  function mkImageEvent(setId: string, index: number, total: number, msgId: string) {
    return {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'image', id: msgId, imageSet: { id: setId, index, total } },
    };
  }

  function setupMediaMocks() {
    mockFetchContent.mockResolvedValue({ buffer: Buffer.from('img'), mimeType: 'image/jpeg' });
    // 呼び出しごとに別ファイル名を返す (= 画像ごとの save を模す)
    let n = 0;
    mockSaveContent.mockImplementation(() => {
      n += 1;
      return Promise.resolve({
        filePath: `/tmp/media-test/line-images/img-${n}.jpg`,
        relativePath: `line-images/img-${n}.jpg`,
        fileName: `img-${n}.jpg`,
        mimeType: 'image/jpeg',
        fileSize: 100,
      });
    });
  }

  test('imageSet 2枚 → 1回の postImagesToTealus に束ね (index 昇順・個別 post なし)', async () => {
    setupMediaMocks();
    const cfg = { ...TEST_CONFIG, skipCatalog: true };

    // ★ 順不同到着 (= LINE 仕様): index 2 → index 1
    const r1 = await dispatchEvent(mkImageEvent('set-unit-1', 2, 2, 'm-b'), { config: cfg });
    expect(r1).toEqual({ posted: 'image-set-buffered' });
    expect(mockPostImages).not.toHaveBeenCalled();

    const r2 = await dispatchEvent(mkImageEvent('set-unit-1', 1, 2, 'm-a'), { config: cfg });
    expect(r2).toEqual({ posted: 'image-set' });
    await flushTick();

    expect(mockPostImages).toHaveBeenCalledTimes(1);
    expect(mockPostImage).not.toHaveBeenCalled(); // 個別 post は走らない
    const call = mockPostImages.mock.calls[0][0] as {
      roomId: string; mediaInfos: Array<{ fileName: string }>;
    };
    expect(call.roomId).toBe('room-X');
    // 到着順 img-1(index2), img-2(index1) → flush は index 昇順 = img-2, img-1
    expect(call.mediaInfos.map((m) => m.fileName)).toEqual(['img-2.jpg', 'img-1.jpg']);
  });

  test('imageSet なし → 従来どおり個別 postImageToTealus', async () => {
    setupMediaMocks();
    const event = {
      type: 'message',
      source: { type: 'group', groupId: 'group-X' },
      message: { type: 'image', id: 'm-single' },
    };
    const result = await dispatchEvent(event, { config: { ...TEST_CONFIG, skipCatalog: true } });
    expect(result).toEqual({ posted: 'image' });
    expect(mockPostImage).toHaveBeenCalledTimes(1);
    expect(mockPostImages).not.toHaveBeenCalled();
  });

  test('imageSet total=1 は defensive に個別 post 扱い', async () => {
    setupMediaMocks();
    const result = await dispatchEvent(mkImageEvent('set-unit-solo', 1, 1, 'm-solo'), {
      config: { ...TEST_CONFIG, skipCatalog: true },
    });
    expect(result).toEqual({ posted: 'image' });
    expect(mockPostImage).toHaveBeenCalledTimes(1);
    expect(mockPostImages).not.toHaveBeenCalled();
  });
});
