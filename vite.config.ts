import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/Unitale/',
  plugins: [vue()],
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        zh: fileURLToPath(new URL('./index.html', import.meta.url)),
        en: fileURLToPath(new URL('./index_en.html', import.meta.url)),
      },
    },
  },
})
