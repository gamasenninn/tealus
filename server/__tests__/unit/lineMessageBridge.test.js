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
jest.mock('../../src/db/pool', () => ({
  connect: jest.fn(() => Promise.resolve(mockClient)),
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock sharp (= optional dependency、image metadata fallback test 用)
jest.mock('sharp', () => {
  return jest.fn(() => ({
    metadata: jest.fn().mockResolvedValue({ width: 100, height: 80 }),
  }));
});

// Mock transcription module
const mockTranscribeFn = jest.fn(() => Promise.resolve());
jest.mock('../../src/services/transcription', () => ({
  transcribeVoiceMessage: (...args) => mockTranscribeFn(...args),
}));

// Mock thumbnail (= Phase 2.1 video 用、ffmpeg dependency 排除)
const mockGenerateThumbnail = jest.fn(() => Promise.resolve('thumbnails/x_thumb.jpg'));
jest.mock('../../src/services/thumbnail', () => ({
  generateThumbnail: (...args) => mockGenerateThumbnail(...args),
}));

const {
  postTextToTealus,
  postImageToTealus,
  postVoiceToTealus,
  postFileToTealus,
  postVideoToTealus,
  postLocationToTealus,
} = require('../../src/services/lineMessageBridge');

function makeMockIo() {
  const emit = jest.fn();
  const io = { to: jest.fn(() => ({ emit })) };
  return { io, emit, ioTo: io.to };
}

function setupSqlSequence(rows) {
  // rows = array of result rows for sequential queries (BEGIN + INSERTs + COMMIT)
  mockClient.query.mockReset();
  let i = 0;
  mockClient.query.mockImplementation(() => {
    const r = rows[i++];
    return Promise.resolve(r || { rows: [] });
  });
}

beforeEach(() => {
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockTranscribeFn.mockReset();
  mockGenerateThumbnail.mockReset();
  mockGenerateThumbnail.mockResolvedValue('thumbnails/x_thumb.jpg');
});

describe('postTextToTealus', () => {
  test('SQL INSERT + Socket.IO emit', async () => {
    const newMsg = { id: 'msg-1', room_id: 'room-1', type: 'text', content: 'hello', sender_id: 'bot-1' };
    setupSqlSequence([
      { rows: [] },           // BEGIN
      { rows: [newMsg] },     // INSERT INTO messages
      { rows: [] },           // COMMIT
    ]);

    const { io, emit } = makeMockIo();
    const result = await postTextToTealus({
      roomId: 'room-1',
      senderUserId: 'bot-1',
      content: 'hello',
      io,
    });

    expect(result.message).toEqual(newMsg);
    expect(io.to).toHaveBeenCalledWith('room-1');
    expect(emit).toHaveBeenCalledWith('message:new', expect.objectContaining({ id: 'msg-1' }));
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('roomId 未指定で throw', async () => {
    await expect(postTextToTealus({ senderUserId: 'bot-1', content: 'x' })).rejects.toThrow(/roomId/);
  });

  test('senderUserId 未指定で throw', async () => {
    await expect(postTextToTealus({ roomId: 'r', content: 'x' })).rejects.toThrow(/senderUserId/);
  });

  test('SQL error で ROLLBACK + release + rethrow', async () => {
    mockClient.query.mockReset();
    mockClient.query.mockImplementation((sql) => {
      if (sql === 'BEGIN') return Promise.resolve();
      if (sql.includes('INSERT INTO messages')) return Promise.reject(new Error('db down'));
      if (sql === 'ROLLBACK') return Promise.resolve();
      return Promise.resolve({ rows: [] });
    });

    await expect(postTextToTealus({
      roomId: 'room-1',
      senderUserId: 'bot-1',
      content: 'x',
    })).rejects.toThrow(/db down/);

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('io 未指定でも成功 (= broadcast skip)', async () => {
    setupSqlSequence([{}, { rows: [{ id: 'm', room_id: 'r' }] }, {}]);
    const result = await postTextToTealus({
      roomId: 'r',
      senderUserId: 'b',
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
      senderUserId: 'bot-1',
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
    await expect(postImageToTealus({ roomId: 'r', senderUserId: 'b' })).rejects.toThrow(/mediaInfo/);
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
      senderUserId: 'bot-1',
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
      senderUserId: 'b',
      mediaInfo: { relativePath: 'p', fileName: 'f', fileSize: 1, mimeType: 'audio/m4a' },
    });

    const queries = mockClient.query.mock.calls.map((c) => c[0]);
    const hasTranscriptionsInsert = queries.some((q) => typeof q === 'string' && q.includes('voice_transcriptions'));
    expect(hasTranscriptionsInsert).toBe(true);
  });

  test('mediaInfo 未指定で throw', async () => {
    await expect(postVoiceToTealus({ roomId: 'r', senderUserId: 'b' })).rejects.toThrow(/mediaInfo/);
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
      senderUserId: 'bot-1',
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
    await expect(postFileToTealus({ roomId: 'r', senderUserId: 'b' })).rejects.toThrow(/mediaInfo/);
  });

  test('transcribe trigger 呼ばれない (= file は transcribe 対象外、回帰防止)', async () => {
    setupSqlSequence([{}, { rows: [{ id: 'm' }] }, { rows: [{ id: 'media' }] }, {}]);
    await postFileToTealus({
      roomId: 'r',
      senderUserId: 'b',
      mediaInfo: { relativePath: 'p', fileName: 'f', fileSize: 1, mimeType: 'application/octet-stream' },
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
      senderUserId: 'bot-1',
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
      senderUserId: 'b',
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
      senderUserId: 'b',
      mediaInfo: { filePath: '/tmp/x.mp4', relativePath: 'p', fileName: 'f', fileSize: 1, mimeType: 'video/mp4' },
    });
    expect(result.message.id).toBe('m');
  });

  test('mediaInfo 未指定で throw', async () => {
    await expect(postVideoToTealus({ roomId: 'r', senderUserId: 'b' })).rejects.toThrow(/mediaInfo/);
  });
});

describe('postLocationToTealus (= Phase 2.2)', () => {
  test('postTextToTealus 経由で markdown 投影 (= 📍 + 緯度経度 + Google Maps link)', async () => {
    setupSqlSequence([{}, { rows: [{ id: 'msg-loc', type: 'text' }] }, {}]);
    const { io, emit } = makeMockIo();

    const result = await postLocationToTealus({
      roomId: 'room-1',
      senderUserId: 'bot-1',
      location: { title: '東京駅', address: '東京都千代田区', latitude: 35.6812, longitude: 139.7671 },
      io,
    });

    expect(result.message.id).toBe('msg-loc');
    // ★ INSERT INTO messages の SQL 呼び出し時の content arg を確認
    const insertCall = mockClient.query.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO messages'));
    expect(insertCall).toBeDefined();
    const contentArg = insertCall[1][2]; // 3rd arg = content
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
      senderUserId: 'b',
      location: { title: null, address: null, latitude: 0, longitude: 0 },
    });
    expect(result.message.id).toBe('m');
    const insertCall = mockClient.query.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO messages'));
    expect(insertCall[1][2]).toContain('📍');
  });

  test('全 field null (= 緯度経度なし) で throw', async () => {
    await expect(postLocationToTealus({
      roomId: 'r',
      senderUserId: 'b',
      location: { title: null, address: null, latitude: null, longitude: null },
    })).rejects.toThrow(/location/);
  });
});
