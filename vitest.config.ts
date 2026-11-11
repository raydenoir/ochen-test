import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: { environment: 'happy-dom', include: ['tests/**/*.ui.test.tsx'], setupFiles: ['tests/setup-assets.ts'], restoreMocks: true },
});
