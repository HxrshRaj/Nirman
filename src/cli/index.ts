#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { buildGraph } from '../resolver/graph';
import { createBundle } from '../bundle/bundle';

function printGraph(entry: string): void {
  const graph = buildGraph(entry);
  const root = process.cwd();
  const short = (p: string) => path.relative(root, p).split(path.sep).join('/');

  console.log(`Entry: ${short(graph.entry)}`);
  console.log(`Modules: ${graph.modules.size}`);
  for (const id of graph.discoveryOrder) {
    const node = graph.modules.get(id)!;
    console.log(`  ${short(id)}`);
    for (const dep of node.dependencies) {
      console.log(`    -> ${dep.specifier}  (${short(dep.resolved)})`);
    }
  }
  if (graph.cycles.length > 0) {
    console.log(`\nCircular dependencies (${graph.cycles.length}):`);
    for (const cycle of graph.cycles) {
      console.log(`  ${[...cycle].map(short).join(' <-> ')}`);
    }
  }
}

function build(entry: string, outFile: string): void {
  const graph = buildGraph(entry);
  const { code, map, ids } = createBundle(graph);

  const mapFile = `${outFile}.map`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${code}\n//# sourceMappingURL=${path.basename(mapFile)}\n`);
  fs.writeFileSync(mapFile, JSON.stringify(map));

  console.log(`Built ${graph.modules.size} modules -> ${outFile} (${code.length} bytes) + source map`);
  console.log(`Entry module id: ${ids.get(graph.entry)}`);
}

function main(): void {
  const [, , cmd, ...rest] = process.argv;

  if (cmd === 'graph') {
    const entry = path.resolve(rest[0] ?? '');
    if (!rest[0]) {
      console.error('Usage: nirman graph <entry-file>');
      process.exit(1);
    }
    printGraph(entry);
    return;
  }

  if (cmd === 'build') {
    const entry = path.resolve(rest[0] ?? '');
    const outIdx = rest.indexOf('--out');
    const outFile = outIdx !== -1 ? path.resolve(rest[outIdx + 1]) : path.resolve('dist-bundle/bundle.js');
    if (!rest[0]) {
      console.error('Usage: nirman build <entry-file> [--out <file>]');
      process.exit(1);
    }
    build(entry, outFile);
    return;
  }

  if (cmd === 'dev') {
    const entry = path.resolve(rest[0] ?? '');
    const portIdx = rest.indexOf('--port');
    const port = portIdx !== -1 ? Number(rest[portIdx + 1]) : 4321;
    if (!rest[0]) {
      console.error('Usage: nirman dev <entry-file> [--port <port>]');
      process.exit(1);
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { startDevServer } = require('../devserver/server');
    startDevServer(entry, port);
    return;
  }

  console.error('Usage: nirman <graph|build|dev> <entry-file> [options]');
  process.exit(1);
}

main();
