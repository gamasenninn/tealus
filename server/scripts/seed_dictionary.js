/**
 * #327 現行 guideline.json を dictionary テーブルに seed する（source='organon'）。
 *
 * guideline.json は organon export の産物なので source='organon' で投入。冪等（upsert）なので
 * 何度流しても安全。読み(reading)は現行 file に無いので NULL のまま（reading 供給は後段）。
 *
 * 使い方: node scripts/seed_dictionary.js
 *   TRANSCRIPTION_GUIDELINE_PATH で入力 file を上書き可（既定は config/transcription_guideline.json）。
 *   DB は .env の接続先。テスト時は .env.test 相当を export して実行。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const repo = require('../src/services/dictionaryRepo');
const pool = require('../src/db/pool');

const GUIDELINE_PATH = process.env.TRANSCRIPTION_GUIDELINE_PATH
  || path.join(__dirname, '../config/transcription_guideline.json');

async function seed() {
  const raw = fs.readFileSync(GUIDELINE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const vocabulary = Array.isArray(parsed.vocabulary) ? parsed.vocabulary : [];

  let terms = 0;
  let aliases = 0;
  for (const v of vocabulary) {
    const term = v && typeof v.term === 'string' ? v.term.trim() : '';
    if (!term) continue;
    const t = await repo.upsertTerm({ term, category: v.category || 'other', source: 'organon' });
    terms += 1;
    const list = Array.isArray(v.aliases) ? v.aliases : [];
    for (const alias of list) {
      const a = typeof alias === 'string' ? alias.trim() : '';
      if (!a) continue;
      await repo.upsertAlias({ termId: t.id, alias: a, source: 'organon', count: 0 });
      aliases += 1;
    }
  }
  return { terms, aliases };
}

if (require.main === module) {
  seed()
    .then(({ terms, aliases }) => {
      console.log(`seeded: ${terms} terms / ${aliases} aliases (source=organon) from ${GUIDELINE_PATH}`);
      return pool.end();
    })
    .catch((err) => {
      console.error('seed failed:', err.message);
      pool.end();
      process.exit(1);
    });
}

module.exports = { seed };
