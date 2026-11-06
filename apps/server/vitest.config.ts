import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests sign vest QRs with a throwaway key, never the live server's data/vest.key.
  test: { env: { VEST_KEY_PATH: join(tmpdir(), `kalikkam-test-vest-${process.pid}.key`) } },
});
