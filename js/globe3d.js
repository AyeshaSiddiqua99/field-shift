// 3D Earth for the CropAhead start screen: NASA Blue Marble (day) + VIIRS Black Marble (night lights), atmosphere glow, stars.
// Drag to spin. flyTo(lat, lon) turns the Earth so the place faces you and zooms in, then resolves.
import * as THREE from 'three';

export function createGlobe(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  camera.position.set(0, 0, 3.6);

  // stars
  const sg = new THREE.BufferGeometry(), sp = [], sc = [];
  for (let i = 0; i < 2500; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(80 + Math.random() * 120); sp.push(v.x, v.y, v.z);
    const t = Math.random(); sc.push(0.75 + 0.25 * t, 0.8 + 0.2 * t, 1);
  }
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.45, vertexColors: true, transparent: true, opacity: 0.85 }));
  scene.add(stars);

  // Earth: NASA Blue Marble colour, NASA Black Marble city lights glowing on the dark side
  const loader = new THREE.TextureLoader();
  const earthMat = new THREE.MeshPhongMaterial({ color: 0x2a4f8a, shininess: 8, specular: 0x223344, emissive: 0xffc27a, emissiveIntensity: 0 });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), earthMat);
  const spin = new THREE.Group(); spin.add(earth); scene.add(spin);
  loader.load('/api/earth?kind=day', t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; earthMat.map = t; earthMat.color.set(0xffffff); earthMat.needsUpdate = true; });
  loader.load('/api/earth?kind=night', t => { t.colorSpace = THREE.SRGBColorSpace; earthMat.emissiveMap = t; earthMat.emissiveIntensity = 0.55; earthMat.needsUpdate = true; });
  const sunL = new THREE.DirectionalLight(0xffffff, 3.2); sunL.position.set(-2, 1.5, 3); scene.add(sunL, new THREE.AmbientLight(0x8fa8d8, 1.1));

  // atmosphere glow
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.12, 64, 48), new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN=normalize(normalMatrix*normal); vec4 p=modelViewMatrix*vec4(position,1.0); vP=p.xyz; gl_Position=projectionMatrix*p; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vP; void main(){ float f=smoothstep(0.0,0.47,-dot(vN,normalize(-vP))); gl_FragColor=vec4(0.3,0.65,1.0,1.0)*pow(f,2.2)*0.9; }`,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  scene.add(atmo);

  // place pin: pulsing ring + beam
  const pin = new THREE.Group(); pin.visible = false; spin.add(pin);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.028, 40), new THREE.MeshBasicMaterial({ color: 0xffc94a, side: THREE.DoubleSide, transparent: true }));
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 24), new THREE.MeshBasicMaterial({ color: 0xffe08a, side: THREE.DoubleSide }));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.08, 8), new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.85 }));
  beam.rotation.x = Math.PI / 2; beam.position.z = 0.04; pin.add(ring, dot, beam);

  // SphereGeometry maps texture u (0 = longitude -180) to phi, with x = -cos(phi) sin(theta), z = sin(phi) sin(theta)
  const pos = (lat, lon) => { const la = lat * Math.PI / 180, ph = (lon + 180) * Math.PI / 180; return new THREE.Vector3(-Math.cos(ph) * Math.cos(la), Math.sin(la), Math.sin(ph) * Math.cos(la)); };

  let rotY = -1.2, rotX = 0.35, tRotY = rotY, tRotX = rotX, dist = 3.6, tDist = 3.6, auto = true, drag = null, fly = null;
  const el = renderer.domElement; el.style.touchAction = 'none';
  el.addEventListener('pointerdown', e => { if (fly) return; drag = { x: e.clientX, y: e.clientY }; auto = false; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => { if (!drag) return; tRotY += (e.clientX - drag.x) * 0.006; tRotX = Math.max(-1.2, Math.min(1.2, tRotX + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; });
  const up = () => { drag = null; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e => { if (fly) return; e.preventDefault(); tDist = Math.max(1.8, Math.min(6, tDist * (e.deltaY > 0 ? 1.08 : 0.92))); }, { passive: false });

  function resize() { const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(container); resize();

  // angles that bring lat/lon to face the camera (+Z)
  function facing(lat, lon) {
    const p = pos(lat, lon);
    const ry = Math.atan2(-p.x, p.z); // rotate about Y so x -> 0
    return { ry, rx: lat * Math.PI / 180 };
  }
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  let offsetX = 0, tOffsetX = 0;

  let last = performance.now();
  (function loop(now) {
    requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (fly) {
      const p = Math.min(1, (now - fly.t0) / fly.ms), e = ease(p);
      rotY = fly.y0 + (fly.y1 - fly.y0) * e; rotX = fly.x0 + (fly.x1 - fly.x0) * e; dist = fly.d0 + (fly.d1 - fly.d0) * e; tRotY = rotY; tRotX = rotX; tDist = dist;
      if (p >= 1) { const r = fly.res; fly = null; r(); }
    } else {
      if (auto) tRotY += dt * 0.08;
      rotY += (tRotY - rotY) * 0.1; rotX += (tRotX - rotX) * 0.1; dist += (tDist - dist) * 0.1;
    }
    offsetX += (tOffsetX - offsetX) * 0.06;
    spin.rotation.set(rotX, rotY, 0, 'XYZ');
    camera.position.set(offsetX, 0, dist); camera.lookAt(offsetX, 0, 0);
    if (pin.visible) { const s = 1 + 0.35 * Math.sin(now / 260); ring.scale.set(s, s, s); ring.material.opacity = 0.9 - 0.4 * (s - 1); }
    stars.rotation.y += dt * 0.004;
    renderer.render(scene, camera);
  })(last);

  return {
    flyTo(lat, lon, ms = 3200) {
      const f = facing(lat, lon); let y1 = f.ry; while (y1 - rotY > Math.PI) y1 -= 2 * Math.PI; while (rotY - y1 > Math.PI) y1 += 2 * Math.PI;
      // pin: sit on the surface, face outwards
      const p = pos(lat, lon); pin.position.copy(p.clone().multiplyScalar(1.001)); pin.lookAt(p.clone().multiplyScalar(2)); pin.visible = true;
      auto = false; tOffsetX = 0;
      if (fly) { const old = fly.res; fly = null; old(); } // a new flight finishes the old one
      return new Promise(res => {
        const me = { t0: performance.now(), ms, y0: rotY, y1, x0: rotX, x1: f.rx, d0: dist, d1: 1.55, res };
        fly = me;
        // animation frames stop when the tab is hidden: never leave the app stuck mid-flight
        setTimeout(() => { if (fly === me) { fly = null; rotY = tRotY = y1; rotX = tRotX = f.rx; dist = tDist = 1.55; res(); } }, ms + 1500);
      });
    },
    reset() { pin.visible = false; auto = true; fly = null; tDist = 3.6; tRotX = 0.35; },
    setOffset(x) { tOffsetX = x; },
    pause(on) { renderer.domElement.style.visibility = on ? 'hidden' : 'visible'; },
  };
}
