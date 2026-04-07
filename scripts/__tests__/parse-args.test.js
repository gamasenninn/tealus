/**
 * CLI引数パーステスト
 * TDD Red phase: まずテストを書く
 */

const { parseSendArgs } = require('../parse-args');

describe('parseSendArgs', () => {
  // 既存: 単発送信
  describe('単発送信（既存動作）', () => {
    test('--text でテキスト送信', () => {
      const result = parseSendArgs(['Web部', '--text', 'こんにちは']);
      expect(result.target).toBe('Web部');
      expect(result.text).toBe('こんにちは');
      expect(result.mode).toBe('send');
    });

    test('--image で画像送信', () => {
      const result = parseSendArgs(['Web部', '--image', './screenshot.png']);
      expect(result.target).toBe('Web部');
      expect(result.image).toBe('./screenshot.png');
      expect(result.mode).toBe('send');
    });

    test('--voice でファイル指定の音声送信', () => {
      const result = parseSendArgs(['Web部', '--voice', './recording.wav']);
      expect(result.target).toBe('Web部');
      expect(result.voice).toBe('./recording.wav');
      expect(result.mode).toBe('send');
    });

    test('@ユーザー名 でDM送信', () => {
      const result = parseSendArgs(['@田中太郎', '--text', 'メッセージ']);
      expect(result.target).toBe('@田中太郎');
      expect(result.text).toBe('メッセージ');
    });
  });

  // 新規: 監視モード
  describe('--watch 監視モード', () => {
    test('--voice --watch <dir> で監視モード', () => {
      const result = parseSendArgs(['Web部', '--voice', '--watch', '/path/to/dir']);
      expect(result.target).toBe('Web部');
      expect(result.mode).toBe('watch');
      expect(result.watchDir).toBe('/path/to/dir');
      expect(result.extensions).toEqual(['.wav']);  // デフォルト
    });

    test('--ext でカンマ区切りの拡張子指定', () => {
      const result = parseSendArgs(['Web部', '--voice', '--watch', '/path/to/dir', '--ext', '.wav,.mp4,.mp3']);
      expect(result.extensions).toEqual(['.wav', '.mp4', '.mp3']);
    });

    test('--ext なしはデフォルト .wav', () => {
      const result = parseSendArgs(['Web部', '--voice', '--watch', '/path/to/dir']);
      expect(result.extensions).toEqual(['.wav']);
    });
  });

  // パースルール: --voice の次が -- で始まるか
  describe('--voice パース判定', () => {
    test('--voice の直後にファイルパス → 単発送信', () => {
      const result = parseSendArgs(['Web部', '--voice', 'file.wav']);
      expect(result.mode).toBe('send');
      expect(result.voice).toBe('file.wav');
    });

    test('--voice の直後に --watch → 監視モード', () => {
      const result = parseSendArgs(['Web部', '--voice', '--watch', '/dir']);
      expect(result.mode).toBe('watch');
    });

    test('--voice が末尾で --watch なし → エラー', () => {
      expect(() => parseSendArgs(['Web部', '--voice'])).toThrow();
    });
  });

  // 相互排除
  describe('相互排除', () => {
    test('--watch と --text の同時指定はエラー', () => {
      expect(() => parseSendArgs(['Web部', '--text', 'msg', '--voice', '--watch', '/dir'])).toThrow();
    });

    test('--watch と --image の同時指定はエラー', () => {
      expect(() => parseSendArgs(['Web部', '--image', './img.png', '--voice', '--watch', '/dir'])).toThrow();
    });
  });

  // エラーケース
  describe('エラーケース', () => {
    test('送信先なしはエラー', () => {
      expect(() => parseSendArgs([])).toThrow();
    });

    test('--text, --image, --voice いずれもなしはエラー', () => {
      expect(() => parseSendArgs(['Web部'])).toThrow();
    });

    test('--watch にディレクトリ指定なしはエラー', () => {
      expect(() => parseSendArgs(['Web部', '--voice', '--watch'])).toThrow();
    });
  });
});
