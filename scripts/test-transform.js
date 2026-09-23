const path = require('path');
const acorn = require('acorn');
const { SourceMapConsumer } = require('source-map');
const { buildGraph } = require('../dist/resolver/graph');
const { transformModule } = require('../dist/transform/pipeline');

async function main() {
  const entry = path.resolve('test-projects/transform-demo/Greeting.jsx');
  const graph = buildGraph(entry);
  const node = graph.modules.get(entry);

  const { code, map } = transformModule(node);

  console.log('--- Transformed output ---');
  console.log(code);
  console.log('--- End output ---\n');

  // 1. Confirm the output is syntactically valid JS (real parser, not "looks fine to me").
  acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
  console.log('OK: transformed output parses as valid JS.\n');

  // 2. Concretely verify the source map: find the generated line for `label.trim` usage
  //    inside formatName import line, and a JSX line, then map back and compare against
  //    the ORIGINAL source text at that reported location.
  const originalLines = node.source.split('\n');
  const generatedLines = code.split('\n');

  const consumer = await new SourceMapConsumer(map);

  function checkLine(generatedLineText, label) {
    const genLineNo = generatedLines.findIndex((l) => l.includes(generatedLineText));
    if (genLineNo === -1) throw new Error(`Could not find generated line containing: ${generatedLineText}`);
    const genCol = generatedLines[genLineNo].indexOf(generatedLineText);
    const pos = consumer.originalPositionFor({ line: genLineNo + 1, column: genCol });
    console.log(`[${label}] generated ${genLineNo + 1}:${genCol}  ->  original ${pos.line}:${pos.column}`);
    if (pos.line == null) throw new Error(`No mapping found for ${label}`);
    const originalLineText = originalLines[pos.line - 1];
    console.log(`  original line ${pos.line} text: ${JSON.stringify(originalLineText)}`);
    return { pos, originalLineText };
  }

  // "className" attribute on the outer div -> should map back to the JSX source line
  // that literally contains `className="greeting"`.
  const r1 = checkLine('className: "greeting"', 'div className attribute');
  if (!r1.originalLineText.includes('className="greeting"')) {
    throw new Error('Source map for className attribute did not point at the correct original line');
  }
  console.log('OK: className attribute mapping points at the correct original source line.\n');

  // The `unread} new` text literal should map back to the original JSX line with that text.
  const r2 = checkLine('" new"', 'badge text literal');
  if (!r2.originalLineText.includes('new</span>')) {
    throw new Error('Source map for text literal did not point at the correct original line');
  }
  console.log('OK: text-literal mapping points at the correct original source line.\n');

  consumer.destroy();
  console.log('All transform + source-map checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
