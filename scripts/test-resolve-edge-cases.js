const path = require('path');
const assert = require('assert');
const { resolveModule } = require('../dist/resolver/resolve');

const root = path.resolve('test-projects/graph-demo/src');
const importer = path.join(root, 'app.js');

// node_modules resolution via package.json "main"
const leftPad = resolveModule('left-pad', importer);
assert.strictEqual(leftPad, path.resolve('test-projects/graph-demo/node_modules/left-pad/index.js'));
console.log('OK: node_modules package.json "main" resolution ->', path.relative('.', leftPad));

// extension inference: './constants' with no extension -> constants.js
const constants = resolveModule('./constants', importer);
assert.strictEqual(constants, path.join(root, 'constants.js'));
console.log('OK: extension inference (.js) ->', path.relative('.', constants));

// directory + index resolution
const fs = require('fs');
const dirTest = path.join(root, 'pkgdir');
fs.mkdirSync(dirTest, { recursive: true });
fs.writeFileSync(path.join(dirTest, 'index.ts'), 'export const x = 1;\n');
const dirResolved = resolveModule('./pkgdir', importer);
assert.strictEqual(dirResolved, path.join(dirTest, 'index.ts'));
console.log('OK: directory -> index.ts resolution ->', path.relative('.', dirResolved));
fs.rmSync(dirTest, { recursive: true, force: true });

// missing module throws
try {
  resolveModule('./does-not-exist', importer);
  console.log('FAIL: expected resolve error');
  process.exit(1);
} catch (e) {
  console.log('OK: missing module throws ->', e.message.slice(0, 60) + '...');
}

console.log('\nAll resolver edge-case checks passed.');
