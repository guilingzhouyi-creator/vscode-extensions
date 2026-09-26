import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true // preview proxy host must be accepted
  },
  preview: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    allowedHosts: true
  },
  build: {
    target: 'es2022',
    sourcemap: true
  }
});
