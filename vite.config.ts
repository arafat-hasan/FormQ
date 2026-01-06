import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifest from './src/manifest.json';

export default defineConfig({
    plugins: [
        react(),
        crx({ manifest }),
    ],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@shared': resolve(__dirname, 'src/shared'),
            '@background': resolve(__dirname, 'src/background'),
            '@content': resolve(__dirname, 'src/content'),
            '@popup': resolve(__dirname, 'src/popup'),
            '@options': resolve(__dirname, 'src/options'),
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: process.env.NODE_ENV === 'development',
        rollupOptions: {
            input: {
                popup: resolve(__dirname, 'src/popup/index.html'),
                options: resolve(__dirname, 'src/options/index.html'),
            },
        },
    },
    server: {
        port: 5173,
        strictPort: true,
        hmr: {
            port: 5173,
        },
    },
});
