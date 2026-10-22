import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Abre el navegador al arrancar (desactivable con NO_OPEN=1, p. ej. en servidores sin escritorio).
    open: !process.env.NO_OPEN,
    // Permite entrar a través de túneles públicos (npm run tunnel) sin que Vite bloquee el host.
    allowedHosts: ['.loca.lt', '.trycloudflare.com'],
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'charts', test: /node_modules[\\/](recharts|d3-|victory-vendor|es-toolkit|immer|reselect|redux|@reduxjs)/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
})
