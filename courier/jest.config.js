// 配達役 (docs/12)。agent-server と同じく .mts を swc で CJS に変換して Jest で走らせる
module.exports = {
  testMatch: ['**/__tests__/**/*.test.mts'],
  moduleFileExtensions: ['js', 'mts', 'json', 'node'],
  transform: {
    '^.+\.mts$': ['@swc/jest', {
      jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
      module: { type: 'commonjs', ignoreDynamic: true },
    }],
  },
};
