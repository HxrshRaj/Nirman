const path = require('path');
const fs = require('fs');
const { buildGraph } = require('../dist/resolver/graph');
const { createBundle } = require('../dist/bundle/bundle');

const entry = path.resolve('test-projects/graph-demo/src/index.js');
const graph = buildGraph(entry);
const { code, map, ids } = createBundle(graph);

const outDir = path.resolve('.nirman-out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'graph-demo.bundle.js'), code + `\n//# sourceMappingURL=graph-demo.bundle.js.map\n`);
fs.writeFileSync(path.join(outDir, 'graph-demo.bundle.js.map'), JSON.stringify(map));

console.log(`Bundle written: ${code.length} chars, ${graph.modules.size} modules, entry id = ${ids.get(entry)}`);
console.log('\n--- Executing bundle in Node ---\n');

require(path.join(outDir, 'graph-demo.bundle.js'));
