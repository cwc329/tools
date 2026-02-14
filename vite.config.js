import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src',
  base: '/tools/',
  publicDir: 'public',
  build: {
    outDir: '..',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'src/index.html'),
        'ig-exif-hashtag': resolve(import.meta.dirname, 'src/ig-exif-hashtag/index.html'),
      },
    },
  },
})
