// ★ #576 テストが終わったら一時フォルダを片づける (自分の分と、1 日以上前に残された分)
const os = require('os');
const { cleanTestTemp } = require('./__tests__/helpers/testTemp.js');

module.exports = async () => {
  cleanTestTemp(os.tmpdir(), process.pid);
};
