import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const base = mode === 'pages' ? '/Polaris/' : '/'

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['warikan-icon.svg'],
        workbox: {
          // Sentry is intentionally loaded after first paint; precaching it
          // would download the monitoring SDK during the initial visit.
          globIgnores: ['**/esm-*.js'],
        },
        manifest: {
          name: 'Warikan',
          short_name: 'Warikan',
          description: '旅行や飲み会の支出を、ひとつのURLでかんたんに割り勘・精算',
          theme_color: '#e4602f',
          background_color: '#f6f5f2',
          display: 'standalone',
          lang: 'ja',
          scope: base,
          start_url: base,
          icons: [
            {
              src: `${base}warikan-icon.svg`,
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ]
  }
})
