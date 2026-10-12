/**
 * #590 ダッシュボードの基本設定 (settings.json) のうち、今の経路で読まれていない項目。
 * ★ 読むのは Light v1 (light.mts / lightTools.mts) だけ。本番の v2 (lightV2.mts) は読まない
 */
import { inactiveAgentSettings } from '../../src/context/settingsEffect.mts';

describe('#590 inactiveAgentSettings', () => {
  test('★ v2 では 6 項目すべて効かない', () => {
    expect(Object.keys(inactiveAgentSettings('v2')).sort()).toEqual(
      ['context_messages', 'max_turns', 'tool_code_interpreter', 'tool_filesystem', 'tool_generate_image', 'tool_tavily']);
  });
  test('v1 では、どの経路も読まない 3 項目だけ効かない', () => {
    expect(Object.keys(inactiveAgentSettings('v1')).sort()).toEqual(['context_messages', 'tool_filesystem', 'tool_tavily']);
  });
  test('理由は空でない文', () => {
    for (const reason of Object.values(inactiveAgentSettings('v2'))) expect(reason.length).toBeGreaterThan(5);
  });
  test('★ 「v1 で読む」としている項目は、本当に v1 のコードが getSetting で読んでいる (読み手が消えたら落ちる)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const src = ['agents/light.mts', 'agents/lightTools.mts']
      .map((f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8')).join('\n');
    for (const key of ['tool_code_interpreter', 'tool_generate_image', 'max_turns']) {
      expect({ key, read: src.includes(`getSetting('${key}'`) }).toEqual({ key, read: true });
    }
    for (const key of ['tool_tavily', 'tool_filesystem', 'context_messages']) {
      expect({ key, read: src.includes(`getSetting('${key}'`) }).toEqual({ key, read: false });
    }
  });
});
