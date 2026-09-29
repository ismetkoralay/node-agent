import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each workspace package is its own project. Add 'apps/*' here when the first app lands.
    projects: ['packages/*'],
  },
});
