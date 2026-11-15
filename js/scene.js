// 3D view: two fields (current plan vs suggested rotation) replaying the same real NASA weather day by day.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';

const FIELD_W = 34, FIELD_D = 26, GAP = 8, COLS = 18;
const WET = new THREE.Color(0x3d2b1c), DRY = new THREE.Color(0xb08f5f);
const HEAT = new THREE.Color(0xb85c2a), FROST = new THREE.Color(0xeef3f7), STUBBLE = new THREE.Color(0x9a8450), SENESCE = new THREE.Color(0xc9b24a);
const SKY_OK = new THREE.Color(0x6aa5e8), SKY_HOT = new THREE.Color(0xd9b48a), SKY_RAIN = new THREE.Color(0x7d8794), SKY_COLD = new THREE.Color(0xcfe0ee);

export function createScene(container, labelsEl) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = SKY_OK.clone(); scene.fog = new THREE.Fog(SKY_OK.clone(), 90, 190);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 400);
  camera.position.set(0, 26, 52);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0); controls.enableDamping = true; controls.maxPolarAngle = 1.45; controls.minDistance = 18; controls.maxDistance = 160;

  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x5a4a35, 0.75); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0); sun.position.set(30, 50, 25); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x4f6b3a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.6; scene.add(ground);

  // rain
  const RAIN_N = 2200, rpos = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) { rpos[i * 3] = (Math.random() - 0.5) * 100; rpos[i * 3 + 1] = Math.random() * 34; rpos[i * 3 + 2] = (Math.random() - 0.5) * 50; }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xaecbff, size: 0.22, transparent: true, opacity: 0.8 }));
  rain.geometry.setDrawRange(0, 0); scene.add(rain);
  let rainCount = 0;

  let fields = [], labels = [];
  const dummy = new THREE.Object3D(), tmpC = new THREE.Color();
  const plantGeo = new THREE.CylinderGeometry(0.1, 0.3, 1, 6).translate(0, 0.5, 0);

  function clear() {
    for (const f of fields) { scene.remove(f.group); f.group.traverse(o => { if (o.geometry && o.geometry !== plantGeo) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    fields = []; labels.forEach(l => l.el.remove()); labels = [];
  }

  // plans: [{strips:[{name, color, trace, cash, yieldIdx, noWindow, note}]}, ...]; slope in %
  function setPlans(plans, slopePct) {
    clear();
    const tilt = Math.min(0.3, Math.atan(slopePct / 100) * 1.6);
    plans.forEach((plan, fi) => {
      const group = new THREE.Group(); group.position.x = (fi === 0 ? -1 : 1) * (FIELD_W / 2 + GAP / 2); group.rotation.x = tilt; scene.add(group);
      const k = plan.strips.length, stripD = FIELD_D / k, field = { group, strips: [] };
      const border = new THREE.Mesh(new THREE.BoxGeometry(FIELD_W + 1.2, 0.3, FIELD_D + 1.2), new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 1 }));
      border.position.y = -0.3; group.add(border);
      plan.strips.forEach((st, si) => {
        const zc = -FIELD_D / 2 + stripD * (si + 0.5);
        const soil = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W, stripD - 0.5), new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 1 }));
        soil.rotation.x = -Math.PI / 2; soil.position.set(0, -0.12, zc); group.add(soil);
        const rows = Math.max(2, Math.floor((stripD - 1.2) / 1.5)), n = rows * COLS;
        const mat = new THREE.MeshStandardMaterial({ color: st.color, roughness: 0.8 });
        const plants = new THREE.InstancedMesh(plantGeo, mat, n); plants.frustumCulled = false; group.add(plants);
        const base = []; for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) base.push([-FIELD_W / 2 + 1.2 + c * ((FIELD_W - 2.4) / (COLS - 1)), zc - stripD / 2 + 0.9 + r * ((stripD - 1.8) / Math.max(1, rows - 1))]);
        const anchor = new THREE.Object3D(); anchor.position.set(0, 2.4, zc - stripD / 2 + 0.2); group.add(anchor);
        const el = document.createElement('div'); el.className = 'slabel'; labelsEl.appendChild(el);
        const s = { st, soil, plants, mat, base, n, anchor, el, lastKey: '' };
        field.strips.push(s); labels.push(s);
      });
      fields.push(field);
    });
  }

  function setFrame(d, w) {
    // sky and light follow the day's weather
    const sky = SKY_OK.clone();
    if (w.tmax > 33) sky.lerp(SKY_HOT, Math.min(1, (w.tmax - 33) / 8));
    if (w.rain > 2) sky.lerp(SKY_RAIN, Math.min(0.85, w.rain / 18));
    if (w.tmin < 0) sky.lerp(SKY_COLD, 0.6);
    scene.background.copy(sky); scene.fog.color.copy(sky);
    sun.intensity = 0.45 + Math.min(1, w.rad / 26) * 0.9;
    rainCount = Math.min(RAIN_N, Math.round(w.rain * 70)); rain.geometry.setDrawRange(0, rainCount);

    for (const f of fields) for (const s of f.strips) {
      const st = s.st, tr = st.trace;
      const moist = tr.moist[d], inS = tr.inSeason[d] === 1, planted = d >= tr.plant, harvested = d >= tr.harvest;
      s.soil.material.color.copy(DRY).lerp(WET, Math.max(0, Math.min(1, moist * 1.25)));
      let h = 0.001, sc = 1, col = null;
      if (!st.noWindow && planted) {
        if (inS) {
          const t = tr.t[d], can = tr.canopy[d];
          h = 0.15 + can * st.height; sc = 0.6 + can * 1.1;
          col = tmpC.set(st.color);
          if (t > 0.7) col.lerp(SENESCE, Math.min(1, (t - 0.7) / 0.3));
          col.lerp(SENESCE, (1 - tr.ks[d]) * 0.9);
          if (tr.heat[d]) col.lerp(HEAT, 0.4);
          if (tr.frost[d]) col.lerp(FROST, 0.55);
        } else if (harvested) { h = 0.12; sc = 0.8; col = tmpC.copy(STUBBLE); }
      }
      if (col) s.mat.color.copy(col);
      const key = h.toFixed(2) + '|' + sc.toFixed(2);
      if (key !== s.lastKey) {
        for (let i = 0; i < s.n; i++) { const b = s.base[i]; dummy.position.set(b[0], 0, b[1]); dummy.scale.set(sc, h, sc); dummy.updateMatrix(); s.plants.setMatrixAt(i, dummy.matrix); }
        s.plants.instanceMatrix.needsUpdate = true; s.lastKey = key;
      }
      const phase = st.noWindow ? 'cannot be grown here' : !planted ? 'bare soil' : inS ? 'growing' : harvested ? 'harvested' : '';
      s.el.innerHTML = `${st.name} <b>${st.noWindow ? '' : st.yieldText}</b> <span style="opacity:.7">${phase}</span>`;
    }
  }

  const v = new THREE.Vector3();
  function placeLabels() {
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    for (const s of labels) { s.anchor.getWorldPosition(v); v.project(camera); s.el.style.display = v.z > 1 ? 'none' : ''; s.el.style.left = ((v.x * 0.5 + 0.5) * w) + 'px'; s.el.style.top = ((-v.y * 0.5 + 0.5) * h) + 'px'; }
  }

  // frame both fields whatever the screen shape, unless the user has orbited the view themselves
  let userMoved = false; controls.addEventListener('start', () => { userMoved = true; });
  function fit() {
    const k = Math.max(1, Math.min(2.4, 1.9 / camera.aspect));
    camera.position.set(0, 26 * k, 52 * k); controls.target.set(0, 0, 0); controls.update();
  }
  function resize() {
    const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (!userMoved) fit();
  }
  new ResizeObserver(resize).observe(container); resize();

  function loop() {
    requestAnimationFrame(loop);
    if (rainCount > 0) {
      const a = rain.geometry.attributes.position;
      for (let i = 0; i < rainCount; i++) { let y = a.getY(i) - 0.9; if (y < 0) y += 34; a.setY(i, y); }
      a.needsUpdate = true;
    }
    controls.update(); placeLabels(); renderer.render(scene, camera);
  }
  loop();

  return { setPlans, setFrame, resize };
}
