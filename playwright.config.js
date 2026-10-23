import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.js',
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  timeout: 15000,
  use: {
    browserName: 'chromium',
    trace: 'retain-on-failure'
  }
})
