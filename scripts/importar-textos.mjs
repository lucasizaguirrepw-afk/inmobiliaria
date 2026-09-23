// =====================================================================
// Recupera los textos de las propiedades desde la WEB PUBLICADA y los
// carga en el proyecto NUEVO de Supabase (mismos IDs, así los links viejos
// siguen funcionando). Las fotos NO se importan: se resuben desde el admin.
//
// Uso (desde la raíz del proyecto, con Node 22):
//   node --env-file=.env.importacion scripts/importar-textos.mjs            -> simulacro: genera importacion-preview.json
//   node --env-file=.env.importacion scripts/importar-textos.mjs --ejecutar -> carga en la base nueva
// =====================================================================
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const EJECUTAR = process.argv.includes('--ejecutar');
const SITIO = (process.env.SITIO_PUBLICADO || 'https://jessirocapropiedades.com.ar').replace(/\/$/, '');
const { NUEVO_SUPABASE_URL, NUEVO_SUPABASE_SERVICE_ROLE_KEY } = process.env;

// Video genérico que la plantilla vieja mostraba cuando no había video cargado
const VIDEO_DE_RELLENO = 'y9j-BL5ocW8';

// ---------- helpers ----------
function decodificar(texto = '') {
  return texto
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
const limpiar = (html) => decodificar((html || '').replace(/<[^>]+>/g, '')).trim();
const extraer = (html, regex) => { const m = html.match(regex); return m ? m[1] : null; };
const numero = (txt) => {
  if (!txt) return 0;
  const n = Number(txt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

async function bajar(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (migracion-jessi)' } });
  if (!res.ok) throw new Error(`${res.status} al abrir ${url}`);
  return res.text();
}

// Versión "solo texto" de la página: cada etiqueta HTML pasa a ser un salto de línea.
function comoTexto(html) {
  const sinScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  return decodificar(sinScripts.replace(/<[^>]+>/g, '\n'))
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}
// Busca "Etiqueta" y devuelve la línea siguiente (ej: "Ambientes" -> "3")
const lineaDespuesDe = (texto, etiqueta) => {
  const m = texto.match(new RegExp(`(?:^|\\n)${etiqueta}:?\\n([^\\n]+)`, 'i'));
  return m ? m[1] : null;
};

function parsearPropiedad(id, html) {
  const texto = comoTexto(html);

  const titulo = limpiar(extraer(html, /<h1[^>]*>([\s\S]*?)<\/h1>/));

  // Operación y tipo: primero por las etiquetas de colores, si no por la miga "Casa en Venta"
  let operacion = limpiar(extraer(html, /<span[^>]*bg-blue-600 text-white[^>]*>([\s\S]*?)<\/span>/));
  let tipo = limpiar(extraer(html, /<span[^>]*bg-slate-100 text-slate-600[^>]*>([\s\S]*?)<\/span>/));
  const miga = texto.match(/Volver al catálogo\n\/\n(.+?) en (.+)/i);
  if (miga) { tipo = tipo || miga[1].trim(); operacion = operacion || miga[2].trim(); }

  // Precio: busca "USD 145.000" / "ARS 1.200.000" / "$ 50.000" cerca de "Precio de ..."
  const zonaPrecio = texto.slice(Math.max(0, texto.search(/Precio de/i)), texto.search(/Precio de/i) + 200) || texto;
  const mPrecio = zonaPrecio.match(/(USD|U\$S|US\$|ARS|\$)\s*([\d][\d.,]*)/i)
               || texto.match(/(USD|U\$S|US\$|ARS)\s*([\d][\d.,]*)/i);
  const monedaCruda = mPrecio ? mPrecio[1].toUpperCase() : null;
  const moneda = !monedaCruda ? null : /U/.test(monedaCruda) ? 'USD' : 'ARS';
  const precio = mPrecio ? numero(mPrecio[2]) : 0;

  const ambientes = numero(lineaDespuesDe(texto, 'Ambientes'));
  const banios = numero(lineaDespuesDe(texto, 'Baños'));
  const metros_cuadrados = numero((lineaDespuesDe(texto, 'Superficie') || '').replace(/m².*/i, ''));

  const descripcion = decodificar(
    (extraer(html, /<p[^>]*whitespace-pre-line[^>]*>([\s\S]*?)<\/p>/) || '').replace(/<br\s*\/?>/gi, '\n')
  ).trim();

  const srcIframe = (despuesDe) => {
    const i = html.indexOf(despuesDe);
    if (i === -1) return null;
    const tag = html.slice(i).match(/<iframe[^>]*>/);
    const src = tag && tag[0].match(/\ssrc="([^"]*)"/);
    return src ? decodificar(src[1]) : null;
  };
  let video = srcIframe('Recorrido Virtual');
  if (video && video.includes(VIDEO_DE_RELLENO)) video = null;
  const mapa = srcIframe('Ubicación');

  const faltantes = [];
  if (!titulo) faltantes.push('título');
  if (!mPrecio) faltantes.push('precio');
  if (!operacion) faltantes.push('operación');
  if (!tipo) faltantes.push('tipo');
  if (!descripcion) faltantes.push('descripción');

  return {
    faltantes,
    datos: {
      id,
      titulo,
      operacion: operacion || 'Venta',
      tipo_propiedad: tipo || 'Casa',
      precio,
      moneda: moneda || 'USD',
      ambientes,
      banios,
      metros_cuadrados,
      descripcion,
      imagen_principal: null,
      galeria: null,
      mapa_url: mapa || null,
      video_url: video || null,
      activa: true,
      destacada: false,
    },
  };
}

// ---------- programa principal ----------
console.log(EJECUTAR ? '🚀 MODO EJECUCIÓN: se va a cargar la base nueva.\n' : '🔎 SIMULACRO: solo lee la web y genera importacion-preview.json\n');

const listado = await bajar(`${SITIO}/propiedades`);
const ids = [...new Set([...listado.matchAll(/href="\/propiedad\/([0-9a-f-]{36})\/?"/g)].map((m) => m[1]))];
console.log(`📋 Encontré ${ids.length} propiedades publicadas en ${SITIO}/propiedades\n`);
if (!ids.length) { console.error('❌ No encontré propiedades. ¿Cambió la web o ya se redeployó?'); process.exit(1); }

const propiedades = [];
const ahora = Date.now();
for (const [i, id] of ids.entries()) {
  try {
    const html = await bajar(`${SITIO}/propiedad/${id}`);
    if (i === 0) fs.writeFileSync('debug-propiedad.html', html); // muestra para revisar si algo falla
    const { datos: p, faltantes } = parsearPropiedad(id, html);
    // El listado viene del más nuevo al más viejo: armamos fechas que respeten ese orden
    p.created_at = new Date(ahora - i * 60_000).toISOString();
    propiedades.push(p);
    const alerta = faltantes.length ? `  ⚠️ no encontré: ${faltantes.join(', ')}` : '';
    console.log(`  [${i + 1}/${ids.length}] ${p.titulo} — ${p.operacion} · ${p.moneda} ${p.precio.toLocaleString('es-AR')} · ${p.ambientes} amb · ${p.metros_cuadrados} m²${alerta}`);
  } catch (e) {
    console.log(`  [${i + 1}/${ids.length}] ❌ ${id}: ${e.message}`);
  }
}

fs.writeFileSync('importacion-preview.json', JSON.stringify(propiedades, null, 2));
console.log(`\n💾 Todo lo extraído quedó en importacion-preview.json (abrilo y revisalo).`);

if (!EJECUTAR) { console.log('👉 Si se ve bien, corré de nuevo con --ejecutar.'); process.exit(0); }

if (!NUEVO_SUPABASE_URL || !NUEVO_SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Faltan NUEVO_SUPABASE_URL / NUEVO_SUPABASE_SERVICE_ROLE_KEY en .env.importacion');
  process.exit(1);
}
if (NUEVO_SUPABASE_URL.includes('gnhmuonnvmqpzugqzyhn')) {
  console.error('❌ Esa es la URL del proyecto VIEJO. Poné la del proyecto nuevo.');
  process.exit(1);
}

const supabase = createClient(NUEVO_SUPABASE_URL, NUEVO_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { error } = await supabase.from('propiedades').upsert(propiedades, { onConflict: 'id' });
if (error) { console.error('❌ Error cargando en Supabase:', error.message); process.exit(1); }
console.log(`\n✅ ${propiedades.length} propiedades cargadas en la base nueva (sin fotos).`);
