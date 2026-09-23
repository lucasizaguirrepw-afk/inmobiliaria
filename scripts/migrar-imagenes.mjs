// =====================================================================
// Migra las imágenes de Supabase Storage a Cloudinary y actualiza las
// URLs en la tabla "propiedades" (imagen_principal y galeria).
//
// Uso (desde la raíz del proyecto, con Node 22):
//   node --env-file=.env.migracion scripts/migrar-imagenes.mjs            -> simulacro (no cambia nada)
//   node --env-file=.env.migracion scripts/migrar-imagenes.mjs --ejecutar -> migra de verdad
//
// Se puede correr varias veces: solo procesa las URLs que siguen apuntando
// a Supabase, así que si alguna falla, la volvés a correr y sigue.
// =====================================================================
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';

const EJECUTAR = process.argv.includes('--ejecutar');

const {
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  CLOUDINARY_FOLDER = 'jessi-roca',
} = process.env;

const faltan = Object.entries({ PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET })
  .filter(([, v]) => !v).map(([k]) => k);
if (faltan.length) {
  console.error('❌ Faltan variables en el .env.migracion:', faltan.join(', '));
  process.exit(1);
}

const supabase = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---------- helpers ----------
const esDeSupabase = (url) => typeof url === 'string' && url.includes('/storage/v1/object/');

// https://xxx.supabase.co/storage/v1/object/public/imagenes/carpeta/foto.jpg -> { bucket: 'imagenes', path: 'carpeta/foto.jpg' }
function parsearUrl(url) {
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/);
  if (!m) throw new Error('URL de Supabase no reconocida: ' + url);
  return { bucket: m[1], path: decodeURIComponent(m[2]) };
}

async function descargarDeSupabase(url) {
  const { bucket, path } = parsearUrl(url);
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`Supabase no dejó bajar "${path}": ${error.message || error}`);
  return { blob: data, path };
}

async function subirACloudinary(blob, path) {
  const publicId = path.replace(/\.[^.]+$/, '').replace(/[^\w\-/]/g, '_');
  const timestamp = Math.floor(Date.now() / 1000);
  // Los parámetros firmados van en orden alfabético
  const params = { folder: CLOUDINARY_FOLDER, overwrite: 'false', public_id: publicId, timestamp };
  const aFirmar = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const signature = crypto.createHash('sha1').update(aFirmar + CLOUDINARY_API_SECRET).digest('hex');

  const form = new FormData();
  form.append('file', blob, path.split('/').pop());
  for (const [k, v] of Object.entries(params)) form.append(k, String(v));
  form.append('api_key', CLOUDINARY_API_KEY);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error('Cloudinary: ' + (data.error?.message || res.statusText));
  return data.secure_url;
}

// ---------- programa principal ----------
console.log(EJECUTAR ? '🚀 MODO EJECUCIÓN: se van a subir fotos y actualizar la base.\n' : '🔎 SIMULACRO: no se cambia nada. Agregá --ejecutar para migrar.\n');

const { data: propiedades, error } = await supabase.from('propiedades').select('id, titulo, imagen_principal, galeria');
if (error) { console.error('❌ No pude leer la tabla propiedades:', error.message); process.exit(1); }

// Backup de seguridad antes de tocar nada
const archivoBackup = `backup-propiedades-${Date.now()}.json`;
fs.writeFileSync(archivoBackup, JSON.stringify(propiedades, null, 2));
console.log(`💾 Backup de URLs guardado en ${archivoBackup} (${propiedades.length} propiedades)\n`);

const normalizarGaleria = (g) => (typeof g === 'string' ? JSON.parse(g) : g) || [];

// Juntamos todas las URLs de Supabase (sin repetir)
const urls = new Set();
for (const p of propiedades) {
  if (esDeSupabase(p.imagen_principal)) urls.add(p.imagen_principal);
  for (const u of normalizarGaleria(p.galeria)) if (esDeSupabase(u)) urls.add(u);
}
console.log(`🖼️  Imágenes a migrar: ${urls.size}\n`);
if (urls.size === 0) { console.log('✅ No queda nada en Supabase. Listo.'); process.exit(0); }

if (!EJECUTAR) {
  // En el simulacro probamos bajar UNA foto para saber si Supabase Storage está respondiendo
  const primera = [...urls][0];
  try {
    const { blob } = await descargarDeSupabase(primera);
    console.log(`✅ Prueba de descarga OK (${(blob.size / 1024 / 1024).toFixed(2)} MB). Supabase Storage responde.`);
    console.log('   Corré de nuevo con --ejecutar para migrar todo.');
  } catch (e) {
    console.log('⚠️  La prueba de descarga FALLÓ:', e.message);
    console.log('   Storage sigue bloqueado: no tiene sentido ejecutar todavía.');
  }
  process.exit(0);
}

// Migramos cada imagen una sola vez
const mapa = {}; // urlVieja -> urlNueva
const fallidas = [];
let n = 0, megas = 0;
for (const url of urls) {
  n++;
  try {
    const { blob, path } = await descargarDeSupabase(url);
    megas += blob.size / 1024 / 1024;
    mapa[url] = await subirACloudinary(blob, path);
    console.log(`  [${n}/${urls.size}] ✅ ${path}`);
  } catch (e) {
    fallidas.push({ url, error: e.message });
    console.log(`  [${n}/${urls.size}] ❌ ${e.message}`);
  }
}
fs.writeFileSync('mapa-migracion.json', JSON.stringify(mapa, null, 2));

// Actualizamos las filas con las URLs nuevas (las que fallaron quedan como estaban)
let actualizadas = 0;
for (const p of propiedades) {
  const nuevaPrincipal = mapa[p.imagen_principal] || p.imagen_principal;
  const galeriaVieja = normalizarGaleria(p.galeria);
  const nuevaGaleria = galeriaVieja.map((u) => mapa[u] || u);

  const cambio = nuevaPrincipal !== p.imagen_principal || JSON.stringify(nuevaGaleria) !== JSON.stringify(galeriaVieja);
  if (!cambio) continue;

  const { error: errUpd } = await supabase
    .from('propiedades')
    .update({ imagen_principal: nuevaPrincipal, galeria: p.galeria == null ? null : nuevaGaleria })
    .eq('id', p.id);
  if (errUpd) console.log(`  ❌ No se pudo actualizar "${p.titulo}": ${errUpd.message}`);
  else actualizadas++;
}

console.log(`\n📊 Resumen: ${Object.keys(mapa).length} fotos migradas (${megas.toFixed(1)} MB), ${fallidas.length} fallidas, ${actualizadas} propiedades actualizadas.`);
if (fallidas.length) {
  fs.writeFileSync('fallidas.json', JSON.stringify(fallidas, null, 2));
  console.log('⚠️  Las fallidas quedaron en fallidas.json. Volvé a correr el script para reintentarlas.');
}
console.log('👉 Acordate de hacer un nuevo deploy en Netlify para que la web tome las URLs nuevas.');
