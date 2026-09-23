// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import netlify from '@astrojs/netlify';

// https://astro.build/config
export default defineConfig({
  // Las páginas de propiedades se generan en cada visita (SSR) leyendo Supabase:
  // lo que Jessi guarda en el admin aparece solo, sin deploys ni créditos de build.
  adapter: netlify(),
  vite: {
    plugins: [tailwindcss()]
  }
});