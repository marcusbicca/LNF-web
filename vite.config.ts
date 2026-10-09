import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Versão do package.json embutida no build, para o LNF-web carimbar 'cli' em
// toda chamada à lnf-api (ver services/supabase.ts).
const versao = JSON.parse(readFileSync('./package.json', 'utf8')).version

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(versao),
  },
})
