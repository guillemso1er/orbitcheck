// @ts-check
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
    site: 'https://orbitcheck.io',
    output: 'static', // For Cloudflare Pages
    trailingSlash: 'never', // Consistent URL handling
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
});
