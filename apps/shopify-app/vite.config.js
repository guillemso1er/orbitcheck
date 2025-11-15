import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

// Adapted to workspace conventions; set root to the app folder so Vite can
// discover source files and pre-bundle explicit deps to avoid the auto-entry
// detection warning that appears when there is no index.html available.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    root: path.resolve(__dirname, './app'),
    plugins: [react()],
    resolve: {
        alias: {
            '@orbitcheck/contracts': path.resolve(__dirname, '../../packages/contracts/src'),
            'src': path.resolve(__dirname, './app'),
        },
    },
    server: {
        port: 5173,
    },
    optimizeDeps: {
        // When there is no explicit index.html or rollupOptions.input pointing to
        // a JS file, Vite can't infer the entrypoint to pre-bundle deps. These
        // explicit includes help Vite pre-bundle the main React+Shopify libs.
        include: [
            'react',
            'react-dom',
            '@shopify/polaris',
        ],
    },
});
