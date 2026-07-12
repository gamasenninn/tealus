module.exports = {
  testMatch: ['**/__tests__/**/*.test.js', '**/__tests__/**/*.test.mts'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  // #330 TS 移行: 変換済み .mts を CJS に transform して JS テストと混在させる
  moduleFileExtensions: ['js', 'mts', 'json', 'node'],
  transform: {
    // transform を定義すると default (babel-jest) が丸ごと外れ、.js テストの
    // jest.mock 巻き上げが消える (= mock 宣言より前に require するテストが壊れる)。
    // .js への babel-jest を明示して復元する。
    '^.+\\.js$': 'babel-jest',
    '^.+\\.mts$': ['@swc/jest', {
      jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
      // 注意: swc の CJS interop は `import * as X` をプロパティ複製するが、getter 記述子は
      // 保持される。テストから mock の値を動的に書き換える場合は getter/setter で定義すること
      // (実例: __tests__/unit/router.test.js の config mock)。
      module: { type: 'commonjs', ignoreDynamic: true },
    }],
  },
};
