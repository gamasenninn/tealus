import { describe, it, expect, beforeEach } from 'vitest';
import { isFormCollapsed, setFormCollapsed, FORM_COLLAPSE_KEY, FORM_COLLAPSE_LIMIT } from '../src/utils/formCollapse';

describe('formCollapse', () => {
  beforeEach(() => { localStorage.clear(); });

  it('既定では畳んでいない', () => {
    expect(isFormCollapsed('m1')).toBe(false);
  });

  it('畳んだ状態が残る / 戻すと消える', () => {
    setFormCollapsed('m1', true);
    expect(isFormCollapsed('m1')).toBe(true);
    setFormCollapsed('m1', false);
    expect(isFormCollapsed('m1')).toBe(false);
  });

  it('複数のフォームを独立に覚える', () => {
    setFormCollapsed('m1', true);
    setFormCollapsed('m2', true);
    setFormCollapsed('m1', false);
    expect(isFormCollapsed('m1')).toBe(false);
    expect(isFormCollapsed('m2')).toBe(true);
  });

  it('同じ id を二重に畳んでも重複しない', () => {
    setFormCollapsed('m1', true);
    setFormCollapsed('m1', true);
    expect(JSON.parse(localStorage.getItem(FORM_COLLAPSE_KEY)!)).toEqual(['m1']);
  });

  it('★ 上限を超えたら古いものから落ちる (localStorage を無制限に太らせない)', () => {
    for (let i = 0; i < FORM_COLLAPSE_LIMIT + 5; i++) setFormCollapsed(`m${i}`, true);
    const saved = JSON.parse(localStorage.getItem(FORM_COLLAPSE_KEY)!) as string[];
    expect(saved.length).toBe(FORM_COLLAPSE_LIMIT);
    expect(saved).not.toContain('m0');                        // 最古は落ちている
    expect(saved).toContain(`m${FORM_COLLAPSE_LIMIT + 4}`);   // 最新は残る
    expect(isFormCollapsed('m0')).toBe(false);
  });

  it('保存値が壊れていても例外にせず「畳んでいない」に倒す', () => {
    localStorage.setItem(FORM_COLLAPSE_KEY, '{壊れたJSON');
    expect(isFormCollapsed('m1')).toBe(false);
    // 壊れた値の上からでも書き込めて復旧する
    setFormCollapsed('m1', true);
    expect(isFormCollapsed('m1')).toBe(true);
  });

  it('配列でない JSON が入っていても落ちない', () => {
    localStorage.setItem(FORM_COLLAPSE_KEY, '{"a":1}');
    expect(isFormCollapsed('m1')).toBe(false);
  });
});
