/**
 * メッセージアダプター テスト
 */
const { extractPromptFromMessage } = require('../../src/media/messageAdapter');

describe('extractPromptFromMessage', () => {
  test('テキストメッセージはそのまま返す', () => {
    const result = extractPromptFromMessage({ type: 'text', content: 'こんにちは' });
    expect(result).toBe('こんにちは');
  });

  test('音声メッセージは文字起こしテキストを返す', () => {
    const result = extractPromptFromMessage({
      type: 'voice',
      transcription: { formatted_text: '今日は晴れです', raw_text: '今日は晴れです' },
    });
    expect(result).toContain('今日は晴れです');
    expect(result).toContain('音声メッセージ');
  });

  test('音声メッセージで文字起こし未完了', () => {
    const result = extractPromptFromMessage({ type: 'voice' });
    expect(result).toContain('文字起こし未完了');
  });

  test('画像メッセージ（キャプション付き）', () => {
    const result = extractPromptFromMessage({ type: 'image', content: 'この画像を見て' });
    expect(result).toContain('この画像を見て');
    expect(result).toContain('画像');
  });

  test('画像メッセージ（キャプションなし）', () => {
    const result = extractPromptFromMessage({ type: 'image' });
    expect(result).toContain('画像');
    expect(result).toContain('説明');
  });

  test('ファイルメッセージ', () => {
    const result = extractPromptFromMessage({
      type: 'file',
      media: [{ file_name: 'report.pdf' }],
    });
    expect(result).toContain('report.pdf');
  });

  test('動画メッセージ', () => {
    const result = extractPromptFromMessage({ type: 'video', content: '会議の動画です' });
    expect(result).toContain('動画');
  });

  test('システムメッセージは空文字', () => {
    const result = extractPromptFromMessage({ type: 'system', content: 'メンバーが参加しました' });
    expect(result).toBe('');
  });

  test('nullは空文字', () => {
    expect(extractPromptFromMessage(null)).toBe('');
  });
});
