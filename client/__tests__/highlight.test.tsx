/**
 * highlight.tsx — mention/検索キーワードの表示ハイライト純関数。
 * 集約前 (MessageBubble の processMentions/highlightText, VoiceBubble/SearchPage の highlightText) の
 * 振る舞いを固定。特に「同一語の複数出現を全てハイライト」= SearchPage の潜在バグ解消を明文化。
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MENTION_DISPLAY_RE, renderKeywordHighlight, renderMentions } from '../src/utils/highlight';

function html(node: React.ReactNode): string {
  return render(<div>{node}</div>).container.querySelector('div')!.innerHTML;
}

describe('MENTION_DISPLAY_RE', () => {
  it('英数/かな/カナ/漢字/長音/中黒 を含む名前にマッチ (表示用)', () => {
    expect('@abc123'.match(MENTION_DISPLAY_RE)).toEqual(['@abc123']);
    expect('@たろう'.match(MENTION_DISPLAY_RE)).toEqual(['@たろう']);
    expect('@ヤマダ'.match(MENTION_DISPLAY_RE)).toEqual(['@ヤマダ']);
    expect('@山田太郎'.match(MENTION_DISPLAY_RE)).toEqual(['@山田太郎']);
    expect('@アシスタント です'.match(MENTION_DISPLAY_RE)).toEqual(['@アシスタント']);
  });
});

describe('renderKeywordHighlight', () => {
  it('keyword が空/text が空なら text をそのまま返す', () => {
    expect(renderKeywordHighlight('hello', '')).toBe('hello');
    expect(renderKeywordHighlight('', 'x')).toBe('');
    expect(renderKeywordHighlight(null, 'x')).toBe(null);
  });

  it('該当語を <mark> で囲む (class 省略時は素の mark)', () => {
    expect(html(renderKeywordHighlight('hello world', 'world'))).toBe('hello <mark>world</mark>');
  });

  it('markClassName 指定で class を付ける', () => {
    expect(html(renderKeywordHighlight('hello world', 'world', { markClassName: 'search-highlight' })))
      .toBe('hello <mark class="search-highlight">world</mark>');
  });

  it('★ 同一語の複数出現を全てハイライト (SearchPage の regex.test 潜在バグ解消)', () => {
    expect(html(renderKeywordHighlight('a b a b a', 'a')))
      .toBe('<mark>a</mark> b <mark>a</mark> b <mark>a</mark>');
  });

  it('大小無視', () => {
    expect(html(renderKeywordHighlight('Hello', 'hello'))).toBe('<mark>Hello</mark>');
  });

  it('正規表現メタ文字はリテラル扱い (エスケープ)', () => {
    // '.' はワイルドカードでなくリテラルのドットにマッチ
    expect(html(renderKeywordHighlight('a.b axb', '.'))).toBe('a<mark>.</mark>b axb');
  });
});

describe('renderMentions', () => {
  it('メンション無しは素通し', () => {
    expect(renderMentions('こんにちは')).toBe('こんにちは');
  });

  it('@メンションを span.mention-highlight で色付け', () => {
    expect(html(renderMentions('@たろう おはよう')))
      .toBe('<span class="mention-highlight">@たろう</span> おはよう');
  });

  it('メンション無し + searchKeyword はキーワードのみ適用', () => {
    expect(html(renderMentions('テスト です', { searchKeyword: 'です', markClassName: 'search-highlight' })))
      .toBe('テスト <mark class="search-highlight">です</mark>');
  });

  it('メンション + searchKeyword は両方適用 (キーワードは非メンション部分のみ)', () => {
    expect(html(renderMentions('@たろう おはよう', { searchKeyword: 'おはよう', markClassName: 'search-highlight' })))
      .toBe('<span class="mention-highlight">@たろう</span> <mark class="search-highlight">おはよう</mark>');
  });
});
