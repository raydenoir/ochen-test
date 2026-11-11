import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import semanticPlugin from './server/semantic-plugin.mjs';
export default defineConfig(({ mode }) => ({ plugins: [react(), semanticPlugin({ ...loadEnv(mode, process.cwd(), ''), ...process.env })], build: { assetsInlineLimit: 0 } }));
