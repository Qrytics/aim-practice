// Removes stale build output (including old source maps) before a production build.
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
await rm(dist, { recursive: true, force: true });
console.log('cleaned dist/');
