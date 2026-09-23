// Devuelve una versión optimizada de una imagen de Cloudinary:
// formato automático (WebP/AVIF), calidad automática y ancho máximo.
// Si la URL no es de Cloudinary, la devuelve tal cual.
export function optimizar(url, ancho = 800) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/f_auto,q_auto,c_limit,w_${ancho}/`);
}
