/**
 * lineMessageBridge unit test
 *
 * pool / Socket.IO / sharp / transcription module を mock、
 * SQL call sequence + Socket.IO broadcast + transcription trigger を verify。
 */

// Mock pool: pool.connect() → mock client
const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};
jest.mock('../../src/db/pool.mts', () => ({ pool: {
  connect: jest.fn(() => Promise.resolve(mockClient)),
} }));

// Mock logger
jest.mock('../../src/utils/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} }));

// Mock sharp (= optional dependency、image metadata fallback test 用)
jest.mock('sharp', () => {
  return jest.fn(() => ({
    metadata: jest.fn().mockResolvedValue({ width: 100, height: 80 }),
  }));
});

// Mock transcription module
const mockTranscribeFn = jest.fn((..._args: unknown[]): Promise<void> => Promise.resolve());
jest.mock('../../src/services/transcription.mts', () => ({
  transcribeVoiceMessage: (...args: unknown[]) => mockTranscribeFn(...args),
}));

// Mock thumbnail (= Phase 2.1 video 用、ffmpeg dependency 排除)
const mockGenerateThumbnail = jest.fn((..._args: unknown[]): Promise<string> => Promise.resolve('thumbnails/x_thumb.jpg'));
jest.mock('../../src/services/thumbnail.mts', () => ({
  generateThumbnail: (...args: unknown[]) => mockGenerateThumbnail(...args),
}));

// Mock link preview (= OGP 取得で外に出るので、単体テストでは呼ばれたことだけ見る)
const mockProcessLinkPreviews = jest.fn((..._args: unknown[]): Promise<void> => Promise.resolve());
jest.mock('../../src/services/linkPreview.mts', () => ({
  processLinkPreviews: (...args: unknown[]) => mockProcessLinkPreviews(...args),
}));

import type { Server } from 'socket.io';
import {
  postTextToTealus,
  postImageToTealus,
  postImagesToTealus,
  postVoiceToTealus,
  postFileToTealus,
  postVideoToTealus,
  postLocationToTealus,
} from '../../src/services/lineMessageBridge.mts';

function makeMockIo() {
  const emit = jest.fn();
  const io = { to: jest.fn(() => ({ emit })) };
  // mock io は Server の全 method を持たないため境界キャスト (テスト scaffold)
  return { io: io as unknown as Server, emit, ioTo: io.to };
}

function setupSqlSequence(rows: Array<{ rows?: unknown[] } | undefined>) {
  // rows = array of result rows for sequential queries (BEGIN + INSERTs + COMMIT)
  // ★ Option D refactor (= Day 21 PM): helper 内 sender info SELECT 削除、★ ★ sender object 引数で受け取る (= 既存 socket.user / req.user pattern 1:1 整合)
  mockClient.query.mockReset();
  let i = 0;
  mockClient.query.mockImplementation(() => {
    const r = rows[i++];
    return Promise.resolve(r || { rows: [] });
  });
}

// ★ Option D: 全 helper test で再利用する sender object (= 既存 socket.user / req.user 同型)
const TEST_SENDER = { id: 'bot-1', display_name: 'LINE Bridge', avatar_url: 'avatars/line.png' };

beforeEach(() => {
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockTranscribeFn.mockReset();
  mockGenerateThumbnail.mockReset();
  mockGenerateThumbnail.mockResolvedValue('thumbnails/x_thumb.jpg');
  mockProcessLinkPreviews.mockReset();
  mockProcessLinkPreviews.mockResolvedValue(undefined);
});

// ★ リンクプレビューは socket 経由の投稿にしか付いていなかった (socket/handlers/message.mts の 1 か所だけ)。
//   実測 (2026-08-14): link_previews 239 件はすべて socket 経由の人間 4 名のもので、
//   LINE 経由のリンク投稿 13 件はプレビュー 0 件。YouTube の OGP 自体は取れる (既存 87 件)。
//   = 経路が増えたときに、投稿に付随する処理が一緒に増えていなかった。
describe('postTextToTealus のリンクプレビュー (2026-08-14)', () => {
  const newMsg = { id: 'msg-1', room_id: 'room-1', type: 'text', content: 'x', sender_id: 'bot-1' };
  const okSql = () => setupSqlSequence([{ rows: [] }, { rows: [newMsg] }, { rows: [] }]);

  test('★ リンクを含む投稿でプレビュー生成を呼ぶ (socket 経由と同じ扱いにする)', async () => {
    okSql();
    const { io } = makeMockIo();
    const content = 'シバウラS440 動作確認の様子 https://youtu.be/Z96CUBLXZTc';
    await postTextToTealus({ roomId: 'room-1', sender: TEST_SENDER, content, io });

    expect(mockProcessLinkPreviews).toHaveBeenCalledWith('msg-1', content, io, 'room-1');
  });

  test('プレビュー生成の失敗は投稿を壊さない (非同期・投げっぱなし)', async () => {
    okSql();
    mockProcessLinkPreviews.mockRejectedValue(new Error('OGP 取得失敗'));
    const { io } = makeMockIo();

    // 投稿自体は成功して message を返す
    const result = await postTextToTealus({ roomId: 'room-1', sender: TEST_SENDER, content: 'https://x.test/a', io });
    expect(result.message).toEqual(newMsg);
  });

  test('リンクを含まなくても呼ぶ (URL 判定は linkPreview 側の責務)', async () => {
    okSql();
    const { io } = makeMockIo();
    await postTextToTealus({ roomId: 'room-1', sender: TEST_SENDER, content: 'ただのテキスト', io });

    expect(mockProcessLinkPreviews).toHaveBeenCalled();
  });
});

describe('postTextToTealus', () => {
  test('SQL INSERT + Socket.IO emit + sender object 直接 fill (= Option D pattern、Day 21 PM)', async () => {
    const newMsg = { id: 'msg-1', room_id: 'room-1', type: 'text', content: 'hello', sender_id: 'bot-1' };
    setupSqlSequence([
      { rows: [] },           // BEGIN
      { rows: [newMsg] },     // INSERT INTO messages
      { rows: [] },           // COMMIT
    ]);

    const { io, emit } = makeMockIo();
    const result = await postTextToTealus({
      roomId: 'room-1',
      sender: TEST_SENDER,
      content: 'hello',
      io,
    });

    expect(result.message).toEqual(newMsg);
    expect(io.to).toHaveBeenCalledWith('room-1');
    // ★ sender info が emit payload に含まれる (= client が reload なしで icon + name 表示)
    expect(emit).toHaveBeenCalledWith('message:new', expect.objectContaining({
      id: 'msg-1',
      sender_display_name: 'LINE Bridge',
      sender_avatar_url: 'avatars/line.png',
    }));
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('roomId 未指定で throw', async () => {
    await expect(postTextToTealus({ sender: TEST_SENDER, content: 'x' } as unknown as Parameters<typeof postTextToTealus>[0])).rejects.toThrow(/roomId/);
  });

  test('sender 未指定で throw', async () => {
    await expect(postTextToTealus({ roomId: 'r', content: 'x' } as unknown as Parameters<typeof postTextToTealus>[0])).rejects.toThrow(/sender/);
  });

  test('SQL error で ROLLBACK + release + rethrow', async () => {
    mockClient.query.mockReset();
    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN') return Promise.resolve();
      if (typeof sql === 'string' && sql.includes('INSERT INTO messages')) return Promise.reject(new Error('db down'));
      if (sql === 'ROLLBACK') return Promise.resolve();
      return Promise.resolve({ rows: [] });
    });

    await expect(postTextToTealus({
      roomId: 'room-1',
      sender: TEST_SENDER,
      content: 'x',
    })).rejects.toThrow(/db down/);

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('io 未指定でも成功 (= broadcast skip)', async () => {
    setupSqlSequence([{}, { rows: [{ id: 'm', room_id: 'r' }] }, {}]);
    const result = await postTextToTealus({
      roomId: 'r',
      sender: TEST_SENDER,
      content: 'x',
    });
    expect(result.message.id).toBe('m');
  });
});

describe('postImageToTealus', () => {
  test('SQL: messages + media INSERT + Socket.IO emit', async () => {
    const newMsg = { id: 'msg-img', room_id: 'room-1', type: 'image' };
    const newMedia = { id: 'media-1', message_id: 'msg-img', file_path: 'line/x.jpg' };
    setupSqlSequence([
      {},                       // BEGIN
      { rows: [newMsg] },       // INSERT INTO messages
      { rows: [newMedia] },     // INSERT INTO message_media
      {},                       // COMMIT
    ]);

    const { io, emit } = makeMockIo();
    const result = await postImageToTealus({
      roomId: 'room-1',
      sender: TEST_SENDER,
      content: 'a photo',
      mediaInfo: {
        filePath: '/tmp/x.jpg',
        relativePath: 'line/x.jpg',
        fileName: 'x.jpg',
        fileSize: 1234,
        mimeType: 'image/jpeg',
      },
      io,
    });

    expect(result.message).toEqual(newMsg);
    expect(result.media).toEqual(newMedia);
    expect(emit).toHaveBeenCalledWith('message:new', expect.objectContaining({
      id: 'msg-img',
      media: [newMedia],
    }));
  });

  test('mediaInfo 未指定で throw', async () => {
    await expect(postImageToTealus({ roomId: 'r', sender: TEST_SENDER } as unknown as Parameters<typeof postImageToTealus>[0])).rejects.toThrow(/mediaInfo/);
  });
});

describe('postVoiceToTealus', () => {
  test('SQL: messages + media + voice_transcriptions INSERT + Socket.IO + transcribeVoiceMessage 起動', async () => {
    const newMsg = { id: 'msg-voice', room_id: 'room-1', type: 'voice' };
    const newMedia = { id: 'media-v', message_id: 'msg-voice', file_path: 'line-voices/x.m4a' };
    setupSqlSequence([
      {},                       // BEGIN
      { rows: [newMsg] },       // INSERT INTO messages
      { rows: [newMedia] },     // INSERT INTO message_media
      {},                       // INSERT INTO voice_transcriptions
      {},                       // COMMIT
    ]);

    const { io, emit } = makeMockIo();
    const result = await postVoiceToTealus({
      roomId: 'room-1',
      sender: TEST_SENDER,
      mediaInfo: {
        filePath: '/tmp/x.m4a',
        relativePath: 'line-voices/x.m4a',
        fileName: 'x.m4a',
        fileSize: 5678,
        mimeType: 'audio/m4a',
      },
      io,
    });

    expect(result.message).toEqual(newMsg);
    expect(result.media).toEqual(newMedia);
    expect(emit).toHaveBeenCalledWith('message:new', expect.objectContaining({
      id: 'msg-voice',
      media: [newMedia],
    }));

    // ★ ★ ★ transcribeVoiceMessage 自動 trigger 確認 (= 既存 transcription pipeline + organon polyseme inject 連動)
    expect(mockTranscribeFn).toHaveBeenCalledWith(
      'msg-voice',
      'line-voices/x.m4a',
      io,
      'room-1'
    );
  });

  test('voice_transcriptions INSERT も SQL 列に含まれる (= pending status)', async () => {
    setupSqlSequence([
      {},
      { rows: [{ id: 'm', room_id: 'r', type: 'voice' }] },
      { rows: [{ id: 'media' }] },
      {},
      {},
    ]);

    await postVoiceToTealus({
      roomId: 'r',
      sender: TEST_SENDER,
      mediaInfo: { relativePath: 'p', fileName: 'f', fileSize: 1, mimeType: 'audio/m4a' } as unknown as Parameters<typeof postVoiceToTealus>[0]['mediaInfo'],
    });

    const queries = mockClient.query.mock.calls.map((c) => c[0]);
    const hasTranscriptionsInsert = queries.some((q) => typeof q === 'string' && q.includes('voice_transcriptions'));
    expect(hasTranscriptionsInsert).toBe(true);
  });

  test('mediaInfo 未指定で throw', async () => {
    await expect(postVoiceToTealus({ roomId: 'r', sender: TEST_SENDER } as unknown as Parameters<typeof postVoiceToTealus>[0])).rejects.toThrow(/mediaInfo/);
  });
});

describe('postFileToTealus (= Phase 2.1)', () => {
  test('SQL: messages (type=file) + media INSERT (thumbnail/width/height 全部 null) + Socket.IO emit', async () => {
    const newMsg = { id: 'msg-file', room_id: 'room-1', type: 'file' };
    const newMedia = { id: 'media-f', message_id: 'msg-file', file_path: 'line-files/doc.pdf' };
    setupSqlSequence([
      {},                       // BEGIN
      { rows: [newMsg] },       // INSERT INTO messages
      { rows: [newMedia] },     // INSERT INTO message_media
      {},                       // COMMIT
    ]);

    const { io, emit } = makeMockIo();
    const result = await postFileToTealus({
      roomId: 'room-1',
      sender: TEST_SENDER,
      mediaInfo: {
        filePath: '/tmp/doc.pdf',
        relativePath: 'line-files/doc.pdf',
        fileName: 'doc.pdf',
        fileSize: 2048,
        mimeType: 'application/pdf',
      },
      io,
    });

    expect(result.message).toEqual(newMsg);
    expect(result.media).toEqual(newMedia);
    expect(emit).toHaveBeenCalledWith('message:new', expect.objectContaining({
      id: 'msg-file',
      media: [newMedia],
    }));
  });

  test('mediaInfo 未指定で throw', async () => {
    await expect(postFileToTealus({ roomId: 'r', sender: TEST_SENDER } as unknown as Parameters<typeof postFileToTealus>[0])).rejects.toThrow(/mediaInfo/);
  });

  test('transcribe trigger 呼ばれない (= file は transcribe 対象外、回帰防止)', async () => {
    setupSqlSequence([{}, { rows: [{ id: 'm' }] }, { rows: [{ id: 'media' }] }, {}]);
    await postFileToTealus({
      roomId: 'r',
      sender: TEST_SENDER,
      mediaInfo: { relativePath: 'p', fileName: 'f', fileSize: 1, mimeType: 'application/octet-stream' } as unknown as Parameters<typeof postFileToTealus>[0]['mediaInfo'],
    });
    expect(mockTranscribeFn).not.toHaveBeenCalled();
  });
});

describe('postVideoToTealus (= Phase 2.1)', () => {
  test('SQL: messages (type=video) + media INSERT (thumbnail_path 含む) + Socket.IO emit', async () => {
    const newMsg = { id: 'msg-video', room_id: 'room-1', type: 'video' };
    const newMedia = { id: 'media-v', message_id: 'msg-video', file_path: 'line-videos/clip.mp4' };
    setupSqlSequence([
      {},                       // BEGIN
      { rows: [newMsg] },       // INSERT INTO messages
      { rows: [newMedia] },     // INSERT INTO message_media (thumbnail_path 含む)
      {},                       // COMMIT
    ]);

    const { io, emit } = makeMockIo();
    const result = await postVideoToTealus({
      roomId: 'room-1',
      sender: TEST_SENDER,
      mediaInfo: {
        filePath: '/tmp/clip.mp4',
        relativePath: 'line-videos/clip.mp4',
        fileName: 'clip.mp4',
        fileSize: 102400,
        mimeType: 'video/mp4',
      },
      io,
    });

    expect(result.message).toEqual(newMsg);
    expect(result.media).toEqual(newMedia);
    expect(emit).toHaveBeenCalledWith('message:new', expect.objectContaining({
      id: 'msg-video',
      media: [newMedia],
    }));
  });

  test('generateThumbnail が filePath + mimeType で呼ばれる', async () => {
    setupSqlSequence([{}, { rows: [{ id: 'm' }] }, { rows: [{ id: 'media' }] }, {}]);
    await postVideoToTealus({
      roomId: 'r',
      sender: TEST_SENDER,
      mediaInfo: {
        filePath: '/tmp/clip.mp4',
        relativePath: 'line-videos/clip.mp4',
        fileName: 'clip.mp4',
        fileSize: 100,
        mimeType: 'video/mp4',
      },
    });
    expect(mockGenerateThumbnail).toHaveBeenCalledWith('/tmp/clip.mp4', 'video/mp4');
  });

  test('generateThumbnail reject 時も message INSERT 成功 (= thumbnail null fallback)', async () => {
    mockGenerateThumbnail.mockReset();
    mockGenerateThumbnail.mockRejectedValue(new Error('ffmpeg failed'));
    setupSqlSequence([{}, { rows: [{ id: 'm', type: 'video' }] }, { rows: [{ id: 'media' }] }, {}]);

    const result = await postVideoToTealus({
      roomId: 'r',
      sender: TEST_SENDER,
      mediaInfo: { filePath: '/tmp/x.mp4', relativePath: 'p', fileName: 'f', fileSize: 1, mimeType: 'video/mp4' },
    });
    expect(result.message.id).toBe('m');
  });

  test('mediaInfo 未指定で throw', async () => {
    await expect(postVideoToTealus({ roomId: 'r', sender: TEST_SENDER } as unknown as Parameters<typeof postVideoToTealus>[0])).rejects.toThrow(/mediaInfo/);
  });
});

describe('postLocationToTealus (= Phase 2.2)', () => {
  test('postTextToTealus 経由で markdown 投影 (= 📍 + 緯度経度 + Google Maps link)', async () => {
    setupSqlSequence([{}, { rows: [{ id: 'msg-loc', type: 'text' }] }, {}]);
    const { io, emit } = makeMockIo();

    const result = await postLocationToTealus({
      roomId: 'room-1',
      sender: TEST_SENDER,
      location: { title: '東京駅', address: '東京都千代田区', latitude: 35.6812, longitude: 139.7671 },
      io,
    });

    expect(result.message.id).toBe('msg-loc');
    // ★ INSERT INTO messages の SQL 呼び出し時の content arg を確認
    const insertCall = mockClient.query.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO messages'));
    expect(insertCall).toBeDefined();
    const contentArg = insertCall![1][2]; // 3rd arg = content
    expect(contentArg).toContain('📍');
    expect(contentArg).toContain('東京駅');
    expect(contentArg).toContain('35.6812');
    expect(contentArg).toContain('139.7671');
    expect(contentArg).toMatch(/maps\.google\.com\/\?q=35\.6812,139\.7671/);
    expect(emit).toHaveBeenCalled();
  });

  test('title/address 両方 null でも 緯度経度のみで OK', async () => {
    setupSqlSequence([{}, { rows: [{ id: 'm', type: 'text' }] }, {}]);
    const result = await postLocationToTealus({
      roomId: 'r',
      sender: TEST_SENDER,
      location: { title: null, address: null, latitude: 0, longitude: 0 },
    });
    expect(result.message.id).toBe('m');
    const insertCall = mockClient.query.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO messages'));
    expect(insertCall![1][2]).toContain('📍');
  });

  test('全 field null (= 緯度経度なし) で throw', async () => {
    await expect(postLocationToTealus({
      roomId: 'r',
      sender: TEST_SENDER,
      location: { title: null, address: null, latitude: null, longitude: null },
    })).rejects.toThrow(/location/);
  });
});

// ============================================
// postImagesToTealus (#353) — imageSet 束ね投稿
// ============================================
describe('postImagesToTealus', () => {
  const mkMediaInfo = (name: string) => ({
    filePath: `/tmp/media-test/line-images/${name}`,
    relativePath: `line-images/${name}`,
    fileName: name,
    mimeType: 'image/jpeg',
    fileSize: 100,
  });

  test('1 message + N media rows (= media.mts マルチアップロード同型) + emit に media 配列', async () => {
    const newMsg = { id: 'msg-set', room_id: 'room-1', type: 'image', sender_id: 'bot-1' };
    const mediaRow1 = { id: 'md-1', message_id: 'msg-set', file_path: 'line-images/a.jpg' };
    const mediaRow2 = { id: 'md-2', message_id: 'msg-set', file_path: 'line-images/b.jpg' };
    setupSqlSequence([
      { rows: [] },           // BEGIN
      { rows: [newMsg] },     // INSERT INTO messages
      { rows: [mediaRow1] },  // INSERT INTO message_media (1枚目)
      { rows: [mediaRow2] },  // INSERT INTO message_media (2枚目)
      { rows: [] },           // COMMIT
    ]);

    const { io, emit } = makeMockIo();
    const result = await postImagesToTealus({
      roomId: 'room-1',
      sender: TEST_SENDER,
      mediaInfos: [mkMediaInfo('a.jpg'), mkMediaInfo('b.jpg')],
      content: '[小野仙人@出品写真・動画]',
      io,
    });

    expect(result.message).toEqual(newMsg);
    expect(result.media).toEqual([mediaRow1, mediaRow2]);

    // message INSERT は 1 回だけ (= 1 メッセージに束ねる)
    const msgInserts = mockClient.query.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO messages'));
    expect(msgInserts.length).toBe(1);
    expect(msgInserts[0][1][2]).toBe('[小野仙人@出品写真・動画]'); // content = label

    // media INSERT は 2 回 (= 枚数分)
    const mediaInserts = mockClient.query.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO message_media'));
    expect(mediaInserts.length).toBe(2);

    // emit は 1 回、media 配列 2 件
    expect(emit).toHaveBeenCalledTimes(1);
    const emitted = emit.mock.calls[0][1] as { media: unknown[] };
    expect(emitted.media).toEqual([mediaRow1, mediaRow2]);
  });

  test('mediaInfos 空配列で throw', async () => {
    await expect(postImagesToTealus({
      roomId: 'room-1',
      sender: TEST_SENDER,
      mediaInfos: [],
    })).rejects.toThrow(/mediaInfos/);
  });
});
