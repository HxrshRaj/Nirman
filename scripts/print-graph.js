const path = require('path');
const { buildGraph } = require('../dist/resolver/graph');

const entry = path.resolve(process.argv[2] || 'test-projects/graph-demo/src/index.js');
const graph = buildGraph(entry);

const root = path.resolve('.');
const short = (p) => path.relative(root, p).replace(/\\/g, '/');

console.log(`Entry: ${short(graph.entry)}`);
console.log(`Total modules discovered: ${graph.modules.size}`);
console.log('');
console.log('Discovery order:');
graph.discoveryOrder.forEach((id, i) => console.log(`  ${i + 1}. ${short(id)}`));

console.log('');
console.log('Edges (importer -> resolved specifier):');
for (const id of graph.discoveryOrder) {
  const node = graph.modules.get(id);
  for (const dep of node.dependencies) {
    console.log(`  ${short(id)}  --(${dep.specifier})-->  ${short(dep.resolved)}`);
  }
}

console.log('');
console.log('Dependents (reverse edges):');
for (const id of graph.discoveryOrder) {
  const node = graph.modules.get(id);
  console.log(`  ${short(id)} <- [${[...node.dependents].map(short).join(', ')}]`);
}

console.log('');
console.log(`Detected cycles: ${graph.cycles.length}`);
graph.cycles.forEach((cycle, i) => {
  console.log(`  Cycle ${i + 1}: ${[...cycle].map(short).join(' <-> ')}`);
});
