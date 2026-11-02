import swc from 'unplugin-swc';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [swc.vite()],
  test: {
    env: {
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    },
  },
});
