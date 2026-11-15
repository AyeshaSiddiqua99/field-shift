// The "observation stack": real NASA layers (rain, soil moisture, heat, vegetation, water) floating above a satellite image of the
// selected farm, with the farm outlined and a beam through every layer. Each slab is the REAL image of that NASA product for the area
// around the farm on the chosen date; coarse products look blocky because each pixel really is that big.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';

const S = 10, GAP = 1.9, MPP0 = 156543.03392;
export const STACK_LAYERS = [ // top to bottom
  { key: 'rain', name: 'Rainfall', color: 0x4aa3ff, z: 6, timed: true },
  { key: 'soil', name: 'Soil moisture', color: 0x2bd4a0, z: 6, timed: true },
  { key: 'heat', name: 'Heat', color: 0xff7a3d, z: 7, timed: true },
  { key: 'veg', name: 'Vegetation', color: 0x7fd34a, z: 9, timed: true },
  { key: 'water', name: 'Water', color: 0x31c8f0, z: 9, timed: false },
  { key: 'base', name: 'Satellite image', color: 0xffffff, z: null, timed: false },
];

function lonLatToPx(lat, lon, z) {
  const ws = 256 * 2 ** z, s = Math.sin(lat * Math.PI / 180);
  return [(lon + 180) / 360 * ws, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * ws];
}
async function getTile(url) {
  try { const r = await fetch(url); if (!r.ok) return null; const used = r.headers.get('X-Date-Used'); return { bmp: await createImageBitmap(await r.blob()), used }; } catch { return null; }
}
// stitch the tiles that cover a square window (meters) centred on the farm into one 512x512 picture
async function buildTexture(L, site, windowM, date) {
  const base = L.key === 'base';
  const z = base ? Math.max(8, Math.min(17, Math.floor(Math.log2(MPP0 * Math.cos(site.lat * Math.PI / 180) * 512 / windowM)))) : L.z;
  const [cx, cy] = lonLatToPx(site.lat, site.lon, z), mpp = MPP0 * Math.cos(site.lat * Math.PI / 180) / 2 ** z, half = windowM / mpp / 2;
  const x0 = cx - half, x1 = cx + half, y0 = cy - half, y1 = cy + half, n = 2 ** z;
  const tx0 = Math.floor(x0 / 256), tx1 = Math.floor((x1 - 1e-6) / 256), ty0 = Math.max(0, Math.floor(y0 / 256)), ty1 = Math.min(n - 1, Math.floor((y1 - 1e-6) / 256));
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const url = base ? `/api/esri?z=${z}&x=${((tx % n) + n) % n}&y=${ty}` : `/api/gibs?key=${L.key}&date=${date || ''}&z=${z}&x=${((tx % n) + n) % n}&y=${ty}`;
    jobs.push(getTile(url).then(t => ({ t, tx, ty })));
  }
  const tiles = await Promise.all(jobs), ok = tiles.some(o => o.t), used = tiles.find(o => o.t?.used)?.t.used || null;
  const big = document.createElement('canvas'); big.width = (tx1 - tx0 + 1) * 256; big.height = (ty1 - ty0 + 1) * 256; const bg = big.getContext('2d');
  for (const { t, tx, ty } of tiles) if (t) bg.drawImage(t.bmp, (tx - tx0) * 256, (ty - ty0) * 256);
  const out = document.createElement('canvas'); out.width = out.height = 512; const og = out.getContext('2d'); og.imageSmoothingEnabled = base; // data layers stay blocky: no fake detail
  og.drawImage(big, x0 - tx0 * 256, y0 - ty0 * 256, x1 - x0, y1 - y0, 0, 0, 512, 512);
  let any = base; if (!base && ok) { const px = og.getImageData(0, 0, 512, 512).data; for (let i = 3; i < px.length; i += 40) if (px[i] > 0) { any = true; break; } }
  return { canvas: out, ok: ok && any, used, empty: ok && !any }; // empty = NASA answered but this area has no reading that day (e.g. cloud)
}

export function createStack(container, onStatus) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
  camera.position.set(15, 11, 15);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 4.6, 0); controls.enableDamping = true; controls.maxPolarAngle = 1.52; controls.minDistance = 9; controls.maxDistance = 45;
  const n = STACK_LAYERS.length, top = (n - 1) * GAP, slabs = {};
  STACK_LAYERS.forEach((L, i) => {
    const y = (n - 1 - i) * GAP, geo = new THREE.PlaneGeometry(S, S);
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a2740, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat); mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; mesh.renderOrder = i; scene.add(mesh);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: L.color })); edge.rotation.x = -Math.PI / 2; edge.position.y = y + 0.01; edge.renderOrder = 20; scene.add(edge);
    slabs[L.key] = { mesh, mat, y, outline: null };
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, top + 0.6, 8), new THREE.MeshBasicMaterial({ color: 0xff7a3d })); beam.position.y = top / 2; scene.add(beam);

  let site = null, windowKm = 12, dateIso = null; const tok = {};
  function applyTexture(key, canvas, ok) {
    const s = slabs[key]; s.mat.map?.dispose();
    if (ok) { const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = key === 'base' ? THREE.LinearFilter : THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; s.mat.map = tex; s.mat.color.set(0xffffff); s.mat.opacity = key === 'base' ? 1 : 0.9; }
    else { s.mat.map = null; s.mat.color.set(0x1a2740); s.mat.opacity = 0.3; }
    s.mat.needsUpdate = true;
  }
  async function loadLayer(L) {
    if (!site || (L.timed && !dateIso)) return; const mine = tok[L.key] = (tok[L.key] || 0) + 1;
    const r = await buildTexture(L, site, windowKm * 1000, dateIso); if (mine !== tok[L.key]) return;
    applyTexture(L.key, r.canvas, r.ok); onStatus?.(L.key, { ok: r.ok, used: r.used, empty: r.empty });
  }
  function drawOutlines() {
    for (const L of STACK_LAYERS) {
      const s = slabs[L.key]; if (s.outline) { scene.remove(s.outline); s.outline.geometry.dispose(); s.outline = null; } if (!site) continue;
      const k = Math.cos(site.lat * Math.PI / 180), W = windowKm * 1000; let pts;
      if (site.poly && site.poly.length > 2) pts = site.poly.map(p => new THREE.Vector3(((p[1] - site.lon) * 111320 * k) / W * S, s.y + 0.03, -((p[0] - site.lat) * 110540) / W * S));
      else pts = Array.from({ length: 33 }, (_, i) => { const a = i / 32 * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 0.22, s.y + 0.03, Math.sin(a) * 0.22); });
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff7a3d })); line.renderOrder = 30; scene.add(line); s.outline = line;
    }
  }
  const reloadAll = () => { drawOutlines(); STACK_LAYERS.forEach(loadLayer); };

  function resize() { const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(container); resize();
  (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();

  return {
    setSite(s) { site = s; reloadAll(); },
    setDate(iso) { if (iso === dateIso) return; dateIso = iso; STACK_LAYERS.filter(L => L.timed).forEach(loadLayer); },
    setWindowKm(km) { windowKm = km; reloadAll(); },
  };
}
