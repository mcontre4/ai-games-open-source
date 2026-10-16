import type { GameView } from '../../../domain/src/index.ts';
import ts from 'typescript';
const denied = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
  'eval',
  'Function',
  'importScripts',
  'localStorage',
  'sessionStorage',
  'navigator',
  'globalThis',
  'process',
  'require',
  'Deno',
  'Bun',
  'indexedDB',
  'location',
]);
export function analyzeGameSource(source: string, view: GameView = '2d'): void {
  if (source.length > 400_000) throw new Error('Game source exceeds the limit.');
  const ast = ts.createSourceFile(
    'Game.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const failures: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && denied.has(node.text))
      failures.push(`Forbidden API: ${node.text}`);
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (
        !ts.isStringLiteral(spec) ||
        !(view === '2d' ? ['phaser', './sdk'] : ['three', './sdk', './runtime']).includes(spec.text)
      )
        failures.push('Unsupported import.');
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      failures.push('Dynamic imports are forbidden.');
    if (
      ts.isStringLiteral(node) &&
      /\b(?:https?:|file:|javascript:|data:text\/html)/i.test(node.text)
    )
      failures.push('External URLs are forbidden.');
    if (
      ts.isPropertyAccessExpression(node) &&
      [
        'cookie',
        'innerHTML',
        'outerHTML',
        'write',
        'serviceWorker',
        'open',
        'postMessage',
      ].includes(node.name.text)
    )
      failures.push(`Forbidden property: ${node.name.text}`);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (failures.length) throw new Error([...new Set(failures)].join(' '));
  if (
    !source.includes('GameScene') ||
    !source.includes('GameSDK') ||
    !source.includes('submitScore') ||
    !source.includes('saveState')
  )
    throw new Error('Missing required gameplay/SDK contract.');
}
