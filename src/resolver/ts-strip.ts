import * as ts from 'typescript';

/**
 * Strip TypeScript-only syntax (type annotations, interfaces, `as` casts, enums, etc.)
 * down to plain JS+JSX, using the TypeScript compiler's own parser for the one thing
 * acorn fundamentally cannot do (parse TS type syntax). JSX, ESM, and everything else
 * about the *bundling* pipeline (resolution, graph building, module transform, runtime)
 * is Nirman's own code — this is scoped narrowly to "erase TS types so acorn can parse
 * the result", nothing more.
 */
export function stripTypes(source: string, isTsx: boolean): string {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      jsx: isTsx ? ts.JsxEmit.Preserve : ts.JsxEmit.None,
      isolatedModules: true,
      sourceMap: false,
    },
    fileName: isTsx ? 'module.tsx' : 'module.ts',
  });
  return result.outputText;
}
