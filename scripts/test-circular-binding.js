const path = require('path');
const fs = require('fs');
const { buildGraph } = require('../dist/resolver/graph');
const { createBundle } = require('../dist/bundle/bundle');

const entry = path.resolve('test-projects/circular-binding-demo/a.js');
const graph = buildGraph(entry);
const { code } = createBundle(graph);

const outFile = path.resolve('.nirman-out/circular-binding.bundle.js');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, code);
require(outFile);
