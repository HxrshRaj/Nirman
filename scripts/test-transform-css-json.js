const path = require('path');
const assert = require('assert');
const { buildGraph } = require('../dist/resolver/graph');
const { transformModule } = require('../dist/transform/pipeline');
const { kindForFile } = require('../dist/resolver/resolve');

const cssPath = path.resolve('test-projects/transform-demo/theme.css');
const jsonPath = path.resolve('test-projects/transform-demo/config.json');
const fs = require('fs');

function fakeNode(id) {
  return {
    id,
    kind: kindForFile(id),
    source: fs.readFileSync(id, 'utf8'),
    dependencies: [],
    dependents: new Set(),
  };
}

// CSS -> style-injecting JS module
const cssOut = transformModule(fakeNode(cssPath));
console.log('--- CSS transform output ---');
console.log(cssOut.code);
assert.ok(cssOut.code.includes('document.createElement("style")'));
assert.ok(cssOut.code.includes('background: #ffcc00'));
assert.strictEqual(cssOut.map, null);
// must be valid JS
require('acorn').parse(cssOut.code, { ecmaVersion: 'latest' });
console.log('OK: CSS module transform produces valid, style-injecting JS.\n');

// JSON -> module.exports = <data>
const jsonOut = transformModule(fakeNode(jsonPath));
console.log('--- JSON transform output ---');
console.log(jsonOut.code);
const mod = { exports: {} };
new Function('module', 'exports', jsonOut.code)(mod, mod.exports);
assert.strictEqual(mod.exports.greetingDefault, 'friend');
assert.strictEqual(mod.exports.maxUnread, 99);
console.log('OK: JSON module transform executes and exports the right data.\n');

console.log('All CSS/JSON transform checks passed.');
