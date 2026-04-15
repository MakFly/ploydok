// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/*.ts',
  out: './migrations',
});
