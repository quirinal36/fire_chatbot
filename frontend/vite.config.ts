import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      // 사용자 화면과 관리자 화면(ISS-021). 경로는 프로젝트 루트 기준
      input: { main: 'index.html', admin: 'admin.html' },
    },
  },
});
