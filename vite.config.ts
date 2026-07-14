import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['warikan-icon.svg'],
      manifest: {
        name: 'Warikan',
        short_name: 'Warikan',
        description: '旅行や飲み会の支出を、ひとつのURLでかんたんに割り勘・精算',
        theme_color: '#e4602f',
        background_color: '#f6f5f2',
        display: 'standalone',
        lang: 'ja',
        start_url: '/',
        icons: [
          {
            src: '/warikan-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
})
