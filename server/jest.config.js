module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/__tests__/**/*.test.js',
  ],
  setupFiles: ['./jest.setup.js'],
  testTimeout: 15000,
  // #330 TS 移行: 変換済み .mts を CJS に transform して JS テストと混在させる
  // (拡張子なし require は moduleFileExtensions の順で .mts も解決される)
  moduleFileExtensions: ['js', 'mts', 'json', 'node'],
  transform: {
    // transform を定義すると default (babel-jest) が外れ .js テストの jest.mock 巻き上げが
    // 消えるため明示復元 (agent-server で顕在化した地雷の予防)
    '^.+\\.js$': 'babel-jest',
    '^.+\\.mts$': ['@swc/jest', {
      jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
      // ignoreDynamic: ESM 専用 package (file-type 等) の動的 import を require に変換せず素通しする
      module: { type: 'commonjs', ignoreDynamic: true },
    }],
  },
};
