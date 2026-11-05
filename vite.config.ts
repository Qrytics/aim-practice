import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // Public production build ships no source maps. (Not a security boundary:
    // see README. The dev-only debug hook is removed from the JS itself.)
    sourcemap: false,
    // Remove stale output (old maps, old hashed assets) before each build.
    emptyOutDir: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
