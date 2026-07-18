/**
 * #336 parseForm / buildAnswerText 純関数テスト。
 * content 内の ```tealus-form fence の抽出と、回答 text の組み立てを検証。
 */
import { describe, it, expect } from 'vitest';
import { parseForm, buildAnswerText } from '../src/utils/parseForm';
import type { FormSchema } from '../src/types';

const SCHEMA: FormSchema = {
  version: 1,
  title: 'Day59 Q0',
  reply_mention: '@cc-organon',
  fields: [
    {
      id: 'q1', type: 'radio', label: '笹沼さんは?', required: true,
      options: [
        { value: 'record', label: '記録のみ' },
        { value: 'issue', label: '起票' },
        { value: 'other', label: 'その他', allow_text: true, text_label: '補足' },
      ],
    },
    { id: 'q2', type: 'text', label: '記録方針', multiline: true },
  ],
};

function wrap(schema: unknown, header = '見出し'): string {
  return `${header}\n\n\`\`\`tealus-form\n${JSON.stringify(schema)}\n\`\`\``;
}

describe('parseForm', () => {
  it('正常な fence から FormSchema を抽出', () => {
    const s = parseForm(wrap(SCHEMA));
    expect(s).not.toBeNull();
    expect(s!.title).toBe('Day59 Q0');
    expect(s!.reply_mention).toBe('@cc-organon');
    expect(s!.fields).toHaveLength(2);
    expect(s!.fields[0].type).toBe('radio');
  });

  it('fence 不在なら null (fallback シグナル)', () => {
    expect(parseForm('ただのテキスト')).toBeNull();
    expect(parseForm('')).toBeNull();
  });

  it('壊れた JSON なら null', () => {
    expect(parseForm('x\n\n```tealus-form\n{壊れ\n```')).toBeNull();
  });

  it('fields が無い / version 不正なら null (最低限の妥当性)', () => {
    expect(parseForm(wrap({ title: 'x' }))).toBeNull();
    expect(parseForm(wrap({ version: 1, title: 'x' }))).toBeNull(); // fields 無し
  });

  it('allow_text 付き option を保持', () => {
    const s = parseForm(wrap(SCHEMA))!;
    const q1 = s.fields[0];
    if (q1.type !== 'radio') throw new Error('radio 期待');
    expect(q1.options[2].allow_text).toBe(true);
    expect(q1.options[2].text_label).toBe('補足');
  });
});

describe('buildAnswerText', () => {
  it('先頭に reply_mention を単独行で付ける', () => {
    const text = buildAnswerText(SCHEMA, { q1: { value: 'record' }, q2: { text: '通常どおり' } });
    expect(text.startsWith('@cc-organon\n')).toBe(true);
  });

  it('radio 選択の label と自由記述を human-readable に整形', () => {
    const text = buildAnswerText(SCHEMA, { q1: { value: 'issue' }, q2: { text: '週次で見直す' } });
    expect(text).toContain('笹沼さんは?: 起票');
    expect(text).toContain('記録方針: 週次で見直す');
  });

  it('allow_text の補足を追記', () => {
    const text = buildAnswerText(SCHEMA, { q1: { value: 'other', text: '外部の人' }, q2: { text: '' } });
    expect(text).toContain('その他');
    expect(text).toContain('外部の人');
  });

  it('reply_mention 省略時は mention を付けない', () => {
    const noMention: FormSchema = { ...SCHEMA, reply_mention: undefined };
    const text = buildAnswerText(noMention, { q1: { value: 'record' }, q2: { text: '' } });
    expect(text.startsWith('@cc-')).toBe(false);
    expect(text).toContain('笹沼さんは?: 記録のみ');
  });

  it('title を回答見出しに含める', () => {
    const text = buildAnswerText(SCHEMA, { q1: { value: 'record' }, q2: { text: '' } });
    expect(text).toContain('Day59 Q0');
  });
});
