import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Read from default .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
   reporter: process.env.CI ? [['line'], ['junit', { outputFile: 'results.xml' }]] : 'html',
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'on',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    /*
  webServer: [
    {
      command: 'pnpm --filter @orbitcheck/api dev',
      url: 'http://127.0.0.1:8080/health',
      reuseExistingServer: true,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @orbitcheck/dashboard dev',
      url: 'http://localhost:5173/',
      reuseExistingServer: true,
      stdout: 'pipe',
      stderr: 'pipe',
    }
  ],
  */
});
