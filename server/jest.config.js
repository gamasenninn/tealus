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
    '^.+\\.mts$': ['@swc/jest', {
      jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
      module: { type: 'commonjs' },
    }],
  },
};
