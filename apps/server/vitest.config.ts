import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: { BIB_KEY_PATH: '', MAIL_LOG: 'off' },
  },
});
