import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter((e) => !['node_modules', 'dist', 'ios', 'android', '.expo'].includes(e.name))
        .map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])),
    )
  ).flat();
}
const failures: string[] = [];
for (const file of await walk('packages')) {
  if (!file.endsWith('.ts')) continue;
  const source = ts.createSourceFile(
    file,
    await readFile(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (
        file.includes('/domain/') &&
        (!spec.startsWith('.') || /application|adapters|contracts|react|expo|node:/.test(spec))
      )
        failures.push(`${file}: domain imports ${spec}`);
      if (file.includes('/application/') && /adapters|fastify|supabase|node:|expo|react/.test(spec))
        failures.push(`${file}: application imports ${spec}`);
    }
    if (file.includes('/application/') && ts.isClassDeclaration(node)) {
      const methods = node.members.filter(
        (m) =>
          ts.isMethodDeclaration(m) &&
          !m.modifiers?.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword),
      );
      if (methods.length !== 1 || methods[0]?.name?.getText(source) !== 'execute')
        failures.push(`${file}: use cases require one execute method`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
if (failures.length) throw new Error(failures.join('\n'));
console.log('Hexagonal dependency boundaries passed.');
