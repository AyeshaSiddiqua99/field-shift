// "Grow it": a 3D field split in two plots, day by day through real past seasons (NASA POWER weather).
// Left plot = the same crop every year, right plot = the suggested rotation. Plant height, colour (water stress,
// ripening), wet/dry soil and rain all come from the engine's daily trace. Purely a picture of the simulation.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';

const LOOK = { // height (m), shape, green colour, ripe colour
  maize: { h: 2.4, shape: 'tall', g: 0x3f9e3a, r: 0xd9b35a }, sorghum: { h: 1.6, shape: 'tall', g: 0x4a9a3a, r: 0xb5653a }, millet: { h: 1.8, shape: 'tall', g: 0x58a240, r: 0xc9a94a },
  wheat: { h: 1.0, shape: 'thin', g: 0x7cb342, r: 0xe6c25a }, soybean: { h: 0.8, shape: 'bush', g: 0x4caf50, r: 0xc9a227 }, groundnut: { h: 0.5, shape: 'bush', g: 0x5fae5a, r: 0xa98a3a },
  chickpea: { h: 0.6, shape: 'bush', g: 0x86b872, r: 0xc8b06a }, potato: { h: 0.7, shape: 'bush', g: 0x3f8f4a, r: 0x9a8a4a }, sunflower: { h: 2.0, shape: 'flower', g: 0x6aa83a, r: 0xd9a92b },
};
const N = 12, GAP = 0.9; // plants per row and spacing (m)

export function createGrowSim(container, plans, c, onDay) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.domElement.style.cssText = 'display:block;width:100%;height:100%'; container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fd3ff); scene.fog = new THREE.Fog(0x9fd3ff, 30, 70);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200); camera.position.set(0, 11, 14.5);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 0, 0); controls.enableDamping = true; controls.maxPolarAngle = 1.45; controls.minDistance = 6; controls.maxDistance = 40;
  scene.add(new THREE.HemisphereLight(0xdff2ff, 0x5a4630, 1.4)); const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(-8, 14, 6); scene.add(sun);

  // grass around the plots
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshLambertMaterial({ color: 0x6f9a4a })); grass.rotation.x = -Math.PI / 2; grass.position.y = -0.02; scene.add(grass);
  const W = N * GAP, half = W / 2 + 0.8;
  const geo = { tall: new THREE.CylinderGeometry(0.04, 0.12, 1, 6), thin: new THREE.CylinderGeometry(0.015, 0.07, 1, 5), bush: new THREE.SphereGeometry(0.5, 10, 8), flower: new THREE.CylinderGeometry(0.05, 0.09, 1, 6) };
  Object.values(geo).forEach(g => g.translate(0, 0.5, 0));
  const dry = new THREE.Color(0xc29a64), wet = new THREE.Color(0x4a3222), brown = new THREE.Color(0xa07d3c), tmpC = new THREE.Color(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();

  const plots = plans.map((plan, k) => {
    const x0 = (k === 0 ? -half : half);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.2, W + 0.6), new THREE.MeshLambertMaterial({ color: 0x8a6a46 })); soil.position.set(x0, -0.08, 0); scene.add(soil);
    // furrows
    for (let i = 0; i < N; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(W, 0.02, 0.06), new THREE.MeshLambertMaterial({ color: 0x000000, transparent: true, opacity: 0.12 })); f.position.set(x0, 0.03, -W / 2 + GAP / 2 + i * GAP + 0.3); scene.add(f); }
    const meshes = {};
    for (const shape of Object.keys(geo)) { const im = new THREE.InstancedMesh(geo[shape], new THREE.MeshLambertMaterial({ color: 0xffffff }), N * N); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.visible = false; scene.add(im); meshes[shape] = im; }
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffd23f }), N * N); heads.visible = false; scene.add(heads);
    const jit = Array.from({ length: N * N }, () => [(Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, 0.85 + Math.random() * 0.3]);
    return { plan, x0, soil, meshes, heads, jit };
  });

  // rain
  const drops = 700, rg = new THREE.BufferGeometry(), rp = new Float32Array(drops * 3);
  for (let i = 0; i < drops; i++) { rp[i * 3] = (Math.random() - 0.5) * 30; rp[i * 3 + 1] = Math.random() * 12; rp[i * 3 + 2] = (Math.random() - 0.5) * 14; }
  rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rainMat = new THREE.PointsMaterial({ color: 0xbfe6ff, size: 0.09, transparent: true, opacity: 0 }); const rain = new THREE.Points(rg, rainMat); scene.add(rain);

  // timeline: one entry per day across all seasons, both plans share the same calendar
  const seasons = plans[0].seasons.length, days = [];
  for (let si = 0; si < seasons; si++) {
    const a = Math.min(...plans.map(pl => pl.seasons[si].i0)), b = Math.max(...plans.map(pl => pl.seasons[si].i1));
    for (let i = a; i < b; i++) days.push({ si, i });
  }

  let pos = 0, playing = true, speed = 1.6, last = performance.now(), lastShown = -1;
  function paint(d) {
    const day = days[Math.min(days.length - 1, Math.floor(d))], wetDay = c.prec[day.i];
    rainMat.opacity = wetDay > 2 ? Math.min(0.9, 0.3 + wetDay / 25) : Math.max(0, rainMat.opacity - 0.05);
    for (const pl of plots) {
      const se = pl.plan.seasons[day.si], tr = se.tr, k = day.i - se.i0, look = LOOK[se.crop.id] || LOOK.maize;
      const inR = k >= 0 && k < tr.canopy.length, can = inR ? tr.canopy[k] : 0, t = inR ? tr.t[k] : 0, ks = inR ? tr.ks[k] : 1, moist = inR ? tr.moist[k] : 0.6, after = inR && k >= tr.harvest;
      pl.soil.material.color.copy(dry).lerp(wet, Math.max(0, Math.min(1, moist)));
      for (const [shape, im] of Object.entries(pl.meshes)) im.visible = shape === look.shape && (can > 0 || after);
      const im = pl.meshes[look.shape], ripe = t > 0.78 ? Math.min(1, (t - 0.78) / 0.18) : 0;
      tmpC.setHex(look.g).lerp(new THREE.Color(look.r), ripe).lerp(brown, Math.max(0, Math.min(0.85, (1 - ks) * 1.1)));
      const h = after ? 0.08 : Math.max(0.03, look.h * Math.min(1, t / 0.55 + 0.02) * (0.55 + 0.45 * can)), wdt = look.shape === 'bush' ? 0.25 + 0.6 * can : 1;
      let n = 0;
      for (let r = 0; r < N; r++) for (let q2 = 0; q2 < N; q2++) {
        const j = pl.jit[n]; p.set(pl.x0 - W / 2 + GAP / 2 + q2 * GAP + j[0], 0, -W / 2 + GAP / 2 + r * GAP + j[1] + 0.3);
        s.set(wdt * (look.shape === 'bush' ? 1 : 1), h * j[2] * (look.shape === 'bush' ? 0.9 : 1), wdt);
        m4.compose(p, q, s); im.setMatrixAt(n, m4); im.setColorAt(n, tmpC);
        if (look.shape === 'flower') { const hp = p.clone(); hp.y = h * j[2]; m4.compose(hp, q, new THREE.Vector3(1, 0.4, 1).multiplyScalar(Math.min(1, t * 1.6))); pl.heads.setMatrixAt(n, m4); }
        n++;
      }
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      pl.heads.visible = look.shape === 'flower' && t > 0.45 && !after; pl.heads.instanceMatrix.needsUpdate = true;
    }
    const di = Math.floor(d); if (di !== lastShown) { lastShown = di; onDay?.(day, di, days.length); }
  }

  function resize() { const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(container); resize();
  let alive = true;
  (function loop(now) {
    if (!alive) return; requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing) { pos += dt * speed * 22; if (pos >= days.length - 1) { pos = days.length - 1; playing = false; onDay?.(days[pos], pos, days.length, true); } }
    paint(pos);
    const a = rg.attributes.position.array; for (let i = 0; i < drops; i++) { a[i * 3 + 1] -= 0.35; if (a[i * 3 + 1] < 0) a[i * 3 + 1] = 12; } rg.attributes.position.needsUpdate = true;
    controls.update(); renderer.render(scene, camera);
  })(last);

  return {
    play(on) { playing = on ?? !playing; if (playing && pos >= days.length - 1) pos = 0; return playing; },
    restart() { pos = 0; playing = true; },
    seek(f) { pos = f * (days.length - 1); },
    setSpeed(v) { speed = v; },
    destroy() { alive = false; renderer.dispose(); renderer.domElement.remove(); },
    get playing() { return playing; },
  };
}
