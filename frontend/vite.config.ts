import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            if (err && ('code' in err && (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED'))) {
              return;
            }
          });
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            socket.on('error', (err: any) => {
              if (err && (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED')) {
                return;
              }
            });
          });
        },
      },
    },
  },
})
