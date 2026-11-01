// Loads src/js/*.js (in name order, filtered by prefix) into this process's global scope.
// (Each test file runs in its own process under `node --test`, so globals don't leak between files.
//  A vm sandbox was used before but ran the code ~12x slower than V8 in the browser.)
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIR = path.join(__dirname, '..', 'src', 'js');
function load(prefixes) {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort()
    .filter(f => !prefixes || prefixes.some(p => f.startsWith(p)));
  for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(DIR, f), 'utf8'), { filename: f });
  return globalThis.SR;
}
const music = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'music.json'), 'utf8'));
module.exports = { load, music };
