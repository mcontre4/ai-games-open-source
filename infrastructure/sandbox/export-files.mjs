import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
if (!['/workspace/dist', '/workspace/public/assets'].includes(root))
  throw new Error('Export root rejected.');
const files = Object.create(null);
let total = 0;
function walk(path = '') {
  for (const name of readdirSync(join(root, path))) {
    const relative = path ? `${path}/${name}` : name;
    const stat = lstatSync(join(root, relative));
    if (stat.isSymbolicLink()) throw new Error('Symbolic link in output.');
    if (stat.isDirectory()) walk(relative);
    else {
      total += stat.size;
      if (
        !stat.isFile() ||
        stat.size > 10 * 1024 * 1024 ||
        total > 30 * 1024 * 1024 ||
        Object.keys(files).length >= 256
      )
        throw new Error('Export limits exceeded.');
      files[relative] = readFileSync(join(root, relative)).toString('base64');
    }
  }
}
walk();
process.stdout.write(JSON.stringify(files));
