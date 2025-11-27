// @ts-check
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
    site: 'https://orbitcheck.io',

    // For Cloudflare Pages
    output: 'static',

    // Consistent URL handling
    trailingSlash: 'never',

    i18n: {
        locales: ['en'],
        defaultLocale: 'en',
        routing: {
            prefixDefaultLocale: false, // No /en/ prefix for English
        },
    },

    vite: {
        plugins: [tailwindcss()],
    },

    adapter: cloudflare({
        imageService: 'compile',
    }),
});