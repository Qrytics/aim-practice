// Verifies the PRODUCTION output. Fails (exit 1) if:
//  - any .map file exists, or any file references a sourceMappingURL;
//  - the dev-only debug hook name or its snapshot keys appear in executable JS/HTML.
// This inspects shipped files only. Removing source maps is not a security boundary,
// and passing this check says nothing about code that is intentionally public.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Optional first argument: directory to check (default: ../dist). Used to prove the check can fail.
const dist = process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url));
// Only markers that exist SOLELY in the dev-only hook. Names of real simulation fields
// (e.g. firesDiscarded) legitimately appear in production code and must not be listed.
const FORBIDDEN_IN_CODE = ['__aimDebug', 'aim-debug-hook-v1'];
const problems = [];

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

let files;
try {
  files = await walk(dist);
} catch {
  console.error('dist/ not found: run `npm run build` first.');
  process.exit(2);
}

for (const f of files) {
  if (f.endsWith('.map')) problems.push(`source map present: ${f}`);
  if (/\.(js|mjs|html|css)$/.test(f)) {
    const text = await readFile(f, 'utf8');
    if (/sourceMappingURL/.test(text)) problems.push(`sourceMappingURL reference: ${f}`);
    if (/\.(js|mjs|html)$/.test(f)) {
      for (const needle of FORBIDDEN_IN_CODE) {
        if (text.includes(needle)) problems.push(`"${needle}" found in executable file: ${f}`);
      }
    }
  }
}

console.log(`checked ${files.length} files in dist/`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('OK: no source maps; no debug-hook markers in shipped JS/HTML.');
