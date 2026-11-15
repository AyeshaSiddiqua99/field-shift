// Map: satellite imagery, NASA GIBS true colour, street map; click to place a field; clickable farm outlines.
// Uses the global Leaflet (vendor/leaflet.js).
export function createMap(el, h) {
  const L = window.L, map = L.map(el, { worldCopyJump: true, attributionControl: true }).setView([42.0, -93.6], 11);
  const date = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10); // GIBS imagery is available with a short delay
  const layers = {
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }),
    nasa: L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, { maxNativeZoom: 9, maxZoom: 14, attribution: `NASA EOSDIS GIBS, MODIS Terra true colour (${date})` }),
    street: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
  };
  let base = 'sat'; layers.sat.addTo(map);
  const farmGroup = L.layerGroup().addTo(map), selGroup = L.layerGroup().addTo(map);
  let timer = null;
  let drawing = null; // {pts, g, cb} while the user is outlining their land
  map.on('click', e => {
    if (drawing) return drawVertex(e);
    clearTimeout(timer); timer = setTimeout(() => h.onPick(e.latlng.lat, e.latlng.lng), 260); // ignore the clicks of a double-click zoom
  });

  // ----- draw your land: click the corners; click the first corner again (or Finish) to close -----
  function redraw() {
    const g = drawing.g, pts = drawing.pts; g.clearLayers();
    if (pts.length > 1) L.polyline(pts, { color: '#fc6a3d', weight: 3, dashArray: '6 5' }).addTo(g);
    if (pts.length > 2) L.polygon(pts, { color: '#fc6a3d', weight: 0, fillOpacity: 0.15 }).addTo(g);
    pts.forEach((p, i) => L.circleMarker(p, { radius: i === 0 ? 8 : 5, color: '#fff', weight: 2, fillColor: i === 0 ? '#2bd4a0' : '#fc6a3d', fillOpacity: 1 }).addTo(g));
  }
  function drawVertex(e) {
    const pts = drawing.pts;
    if (pts.length >= 3 && map.latLngToContainerPoint(L.latLng(pts[0])).distanceTo(e.containerPoint) < 14) return finishDraw();
    if (pts.length && map.latLngToContainerPoint(L.latLng(pts.at(-1))).distanceTo(e.containerPoint) < 6) return; // a double-click adds one corner, not two
    pts.push([e.latlng.lat, e.latlng.lng]); redraw(); drawing.cb({ pts: [...pts], closed: false });
  }
  function startDraw(cb) {
    cancelDraw(); selGroup.clearLayers(); map.removeLayer(farmGroup); // farm outlines would swallow the corner clicks
    drawing = { pts: [], g: L.layerGroup().addTo(map), cb };
    map.doubleClickZoom.disable(); map.getContainer().style.cursor = 'crosshair'; cb({ pts: [], closed: false });
  }
  function endDrawMode() { drawing.g.remove(); drawing = null; farmGroup.addTo(map); map.doubleClickZoom.enable(); map.getContainer().style.cursor = ''; }
  function undoDraw() { if (!drawing) return; drawing.pts.pop(); redraw(); drawing.cb({ pts: [...drawing.pts], closed: false }); }
  function finishDraw() { if (!drawing || drawing.pts.length < 3) return false; const { pts, cb } = drawing; endDrawMode(); cb({ pts, closed: true }); return true; }
  function cancelDraw() { if (drawing) endDrawMode(); }
  map.on('dblclick', () => clearTimeout(timer));
  map.doubleClickZoom.enable();

  return {
    startDraw, undoDraw, finishDraw, cancelDraw, isDrawing: () => !!drawing,
    setBase(k) { if (k === base) return; map.removeLayer(layers[base]); layers[k].addTo(map); base = k; },
    setView(lat, lon, z) { map.setView([lat, lon], z ?? map.getZoom()); },
    center() { const c = map.getCenter(); return { lat: c.lat, lon: c.lng, zoom: map.getZoom() }; },
    setMarker(lat, lon, poly) {
      selGroup.clearLayers();
      if (poly) L.polygon(poly, { color: '#fc6a3d', weight: 3, fillOpacity: 0.12 }).addTo(selGroup);
      L.circleMarker([lat, lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#fc6a3d', fillOpacity: 1 }).addTo(selGroup);
    },
    showFarms(farms) {
      farmGroup.clearLayers();
      for (const f of farms) {
        const p = L.polygon(f.poly, { color: '#3fd0b5', weight: 2, fillOpacity: 0.18 }).addTo(farmGroup);
        p.bindTooltip(`${f.name || 'Farm outline'} - ${f.ha} ha`);
        p.on('click', ev => { L.DomEvent.stopPropagation(ev); h.onFarm(f); });
      }
    },
    clearFarms() { farmGroup.clearLayers(); },
    fitFarms(farms) { if (farms.length) { const b = L.latLngBounds(farms.flatMap(f => f.poly)); map.fitBounds(b.pad(0.15), { maxZoom: 15 }); } },
    invalidate() { map.invalidateSize(); },
  };
}
