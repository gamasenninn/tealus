/**
 * Markdown plugin config の behavior test (MessageBubble / HomePage 共用)
 *
 * 役割:
 * - `<Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>` の挙動を component 単位で固定
 * - remark-breaks を後で誤って外した時の regression guard (#273 で追加)
 * - 今後の client UI test 拡張時の pattern reference (jsdom + RTL + vitest 構成例)
 *
 * 注: MessageBubble.jsx 本体は store / router / 多数の子 component 依存で
 * mock cost が高いため、本 file では plugin config 部分のみを切り出して test。
 * 同 plugins 配列を MessageBubble.jsx:262 + HomePage.jsx:176 と共有しているので、
 * ここでの behavior 保証がそのまま両 component の markdown render 部に効く。
 */
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

const plugins = [remarkGfm, remarkBreaks];

function renderMd(source) {
  return render(<Markdown remarkPlugins={plugins}>{source}</Markdown>);
}

describe('Markdown plugins (remark-gfm + remark-breaks)', () => {
  it('段落内の単一改行 \\n を <br> に変換する (remark-breaks regression guard)', () => {
    const { container } = renderMd('お疲れさま\nまた明日');
    const brs = container.querySelectorAll('br');
    expect(brs.length).toBe(1);
    expect(container.textContent).toContain('お疲れさま');
    expect(container.textContent).toContain('また明日');
  });

  it('二重改行 \\n\\n は paragraph 区切り、br は挿入されない', () => {
    const { container } = renderMd('第 1 段落\n\n第 2 段落');
    expect(container.querySelectorAll('p').length).toBe(2);
    expect(container.querySelectorAll('br').length).toBe(0);
  });

  it('コードブロック内は <br> 挿入なし、改行は literal で保持', () => {
    const { container } = renderMd('```js\nconst a = 1;\nconst b = 2;\n```');
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre.querySelectorAll('br').length).toBe(0);
    expect(pre.textContent).toContain('const a = 1;');
    expect(pre.textContent).toContain('const b = 2;');
  });

  it('MD 強調 (**bold**) は通常通り render される', () => {
    const { container } = renderMd('これは **太字** です');
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong.textContent).toBe('太字');
  });

  it('リスト構造は <br> 化されず <ul><li> として render される', () => {
    const { container } = renderMd('- 項目 A\n- 項目 B\n- 項目 C');
    expect(container.querySelectorAll('li').length).toBe(3);
    expect(container.querySelector('ul').querySelectorAll('br').length).toBe(0);
  });

  it('GFM table は remark-gfm 共存で正しく render される', () => {
    const md = '| A | B |\n| - | - |\n| 1 | 2 |';
    const { container } = renderMd(md);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('td').length).toBe(2);
  });
});
