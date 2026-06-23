const { decodeFileName } = require('../../src/middleware/upload');

// multer/busboy decodes the multipart `filename` header as latin1 (binary),
// so multibyte (UTF-8) filenames arrive mojibake'd. decodeFileName re-interprets
// the bytes as UTF-8 to recover the original name. See 業務メモ 6/22 (小野さん).
describe('decodeFileName (multipart latin1 → utf8)', () => {
  test('recovers a UTF-8 Japanese filename mangled by busboy latin1 decoding', () => {
    const original = '出品票抽出_2026-06-22.md';
    // Simulate busboy: it reads the UTF-8 bytes of the name as latin1.
    const mojibake = Buffer.from(original, 'utf8').toString('latin1');
    expect(mojibake).not.toBe(original); // sanity: input really is garbled
    expect(decodeFileName(mojibake)).toBe(original);
  });

  test('leaves pure-ASCII filenames unchanged', () => {
    expect(decodeFileName('rec_20260623_120421.wav')).toBe('rec_20260623_120421.wav');
    expect(decodeFileName('shared-0.mp4')).toBe('shared-0.mp4');
  });

  test('handles empty / null / undefined without throwing', () => {
    expect(decodeFileName('')).toBe('');
    expect(decodeFileName(null)).toBe(null);
    expect(decodeFileName(undefined)).toBe(undefined);
  });

  test('keeps genuinely non-UTF-8 (latin1) names instead of producing replacement chars', () => {
    // A real latin1 byte sequence that is NOT valid UTF-8 (lone 0xE9 = é in latin1).
    const latin1Name = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x2e, 0x70, 0x64, 0x66]).toString('latin1'); // café.pdf
    const result = decodeFileName(latin1Name);
    expect(result).not.toContain('�'); // never emit replacement chars
    expect(result).toBe(latin1Name); // fall back to the original bytes
  });
});
