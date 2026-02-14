import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        'ig-exif-hashtag': resolve(import.meta.dirname, 'ig-exif-hashtag/index.html'),
      },
    },
  },
})
