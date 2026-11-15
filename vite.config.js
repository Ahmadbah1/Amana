import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE est défini par le workflow GitHub Pages (ex. /amana/). En local : /
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
});
