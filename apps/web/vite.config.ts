import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith('ion-'),
        },
      },
    }),
  ],
  build: {
    // The @ionic/vue runtime + components total ~1.1 MB minified — that's the
    // floor for any app importing Ion* components by name. Real tree-shaking
    // would require restructuring every component import across the app.
    // Splitting ionic / ionicons / vue into their own chunks (below) gives
    // real cache wins; we then raise the warning limit to acknowledge the
    // unavoidable ionic chunk size.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('@ionic')) return 'ionic';
            if (id.includes('ionicons')) return 'ionicons';
            if (
              id.includes('/vue/') ||
              id.includes('/vue-router/') ||
              id.includes('/@vue/') ||
              id.includes('/pinia/')
            ) return 'vue';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: Number(process.env.VITE_WEB_PORT) || 6101,
    allowedHosts: ['divinr.ai', 'www.divinr.ai', 'localhost'],
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.VITE_API_PORT || '6100'}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          // Disable buffering for SSE streams
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
    },
  },
});
