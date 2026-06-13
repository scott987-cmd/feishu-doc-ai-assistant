import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node', // default; component tests opt into jsdom via a docblock
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    css: false, // ignore CSS imports in component tests
  },
})
