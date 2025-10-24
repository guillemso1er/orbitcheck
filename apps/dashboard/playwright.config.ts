import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://playwright.dev/docs/test-configuration#launch-options
 */
function getDisplaySize() {
  let width = 1200;
  let height = 800;
  if (process.env.CI) {
    width = 800;
    height = 600;
  }
  return { width, height };
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only to recover from intermittent failures. */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['html', { open: 'never' }]],

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use when running `test.use({ baseURL: ... })`. */
    baseURL: 'http://localhost:5173',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    /* Video capture */
    video: 'on',
    /* Viewport size for Chromium, Firefox and WebKit. */
    ...devices['Desktop Chrome'],
    /* Increase action timeout for slower operations */
    actionTimeout: 10000,
    /* Increase navigation timeout */
    navigationTimeout: 30000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...getDisplaySize() },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], ...getDisplaySize() },
    },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'], ...getDisplaySize() },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Google Chrome'], channel: 'chrome' },
    },
  ],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  /* Run your local dev server before starting the tests */
  webServer: [
    {
      command: 'pnpm --filter @orbitcheck/api dev',
      url: 'http://localhost:8080/health',
      reuseExistingServer: true,
    },
    {
      command: 'pnpm --filter @orbitcheck/dashboard dev',
      url: 'http://localhost:5173/',
      reuseExistingServer: true,
    }
  ],
});