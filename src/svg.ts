import { backgroundArtwork } from './backgrounds';
import type { Detail, Layer, Palette, Scene } from './model';
import { getAsset } from './assets';
import { compositionBounds, geometry } from './layout';
export { geometry } from './layout';
export { getAsset } from './assets';
const BASE_BG=['#D7CDF5','#AA9BF0','#7864D7','#181817'];
const BASE_OBJECT=['#F9ECB0','#F9A3AA','#FFE3E1','#FFFFFF'];
const cache = new Map<string,string>();
export function artwork(layer: Pick<Layer, 'id' | 'key' | 'role' | 'detail' | 'color'>, sceneDetail: Detail, palette: Palette) {
  const detail = layer.detail ?? sceneDetail;
  const cacheKey = JSON.stringify([layer.key,layer.id,layer.role,layer.color,detail,palette.background,palette.objects]);
  const cached = cache.get(cacheKey); if (cached) return cached;
  const {raw} = getAsset(layer.key,detail,layer.role);
  const map = new Map(BASE_BG.map((c,i)=>[c,palette.background[i]]));
  // White is a neutral in monochrome artwork, never an object accent on the background.
  if(layer.role==='main') BASE_OBJECT.forEach((c,i)=>map.set(c,palette.objects[i]));
  if (layer.color === 'alternate') {
    if (layer.key === 'lamp' && layer.role === 'background') map.set(BASE_BG[2], palette.background[1]);
    if (layer.key === 'wallet' && layer.role === 'main') {
      map.set(BASE_BG[0], palette.objects[0]);
      map.set(BASE_OBJECT[0], palette.objects[1]);
    }
  }
  let svg = raw.replace(/(fill|stroke|stop-color)="(#[\da-f]{6}|white)"/gi, (_match,attribute:string,color:string)=>`${attribute}="${map.get(color.toLowerCase()==='white'?'#FFFFFF':color.toUpperCase()) ?? color}"`);
  const prefix = `obj-${layer.id}-`;
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  for(const id of ids) {
    const target = prefix+id;
    svg=svg.replaceAll(`id="${id}"`,`id="${target}"`).replaceAll(`url(#${id})`,`url(#${target})`).replaceAll(`href="#${id}"`,`href="#${target}"`);
  }
  // Root width, height and viewBox remain exactly as Figma exported them.
  if(cache.size>600) cache.clear();
  cache.set(cacheKey,svg);return svg;
}
const escape = (s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function exportSVG(scene: Scene) {
  const bg = scene.background ? `<rect width="${scene.width}" height="${scene.height}" fill="${scene.palette.background[0]}"/>` : '';
  const layers=scene.layers.map(l=>{
    const g=geometry(l,scene);
    return `<g id="layer-${l.id}" aria-label="${escape(l.key)}" transform="translate(${l.x*scene.width} ${l.y*scene.height}) rotate(${l.rotation}) translate(${-g.width/2} ${-g.height/2}) scale(${g.scale})">${artwork(l,scene.detail,scene.palette)}</g>`;
  }).join('\n');
  const bounds = scene.layers.length ? compositionBounds(scene.layers, scene) : null;
  const needsClip = bounds && (scene.layout === 'cropped' || bounds.left < 0 || bounds.top < 0
    || bounds.right > scene.width || bounds.bottom > scene.height);
  const objects = needsClip
    ? `<defs><clipPath id="canvas-clip"><rect width="${scene.width}" height="${scene.height}"/></clipPath></defs><g clip-path="url(#canvas-clip)">${layers}</g>`
    : layers;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" role="img"><title>${escape(scene.title)}</title>${bg}${backgroundArtwork(scene)}${objects}</svg>`;
}
export function download(text:string,name:string,type:string) {
  const url=URL.createObjectURL(new Blob([text],{type}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
