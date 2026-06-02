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

const {
  postTextToTealus,
  postImageToTealus,
  postVoiceToTealus,
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
