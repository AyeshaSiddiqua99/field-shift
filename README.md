# Field Shift

NASA Space Apps 2026 prototype for the challenge "Field Shift: Adapting Farms with NASA Data".
Pick a place on a globe, type an address, choose a nearby farm, and see its real NASA layers in 3D
(rain, soil moisture, heat, vegetation, water) with NASA's own colour legends. A rotation simulator and a
"replay your past seasons" page are included.

## Run it

Python 3 only, no packages to install.

```bash
python server.py
```

Then open http://localhost:8765/ and pick a page:

| Page | What it is |
| --- | --- |
| `app.html` | Globe app: globe -> address -> farm list -> real NASA layers. Based on a teammate's globe UI. |
| `layers.html` | The same flow, minimal: world -> address -> farm -> layers. |
| `replay.html` | Replay the past seasons of a farm on NASA weather, with a "does this match your memory?" check. |
| `index.html` | The crop rotation simulator (ranks rotations; shows uncertainty). |

New places need internet (data services below). Ajax, Ontario and six demo regions are cached in `data/`.

## What is real and what is not

Real data:
- 3D layers: NASA IMERG (rain), MERRA-2 (soil moisture), MODIS (land temperature, NDVI) through NASA GIBS, with NASA's colour scales.
- Weather 2005 to now: NASA POWER. Soil: ISRIC SoilGrids. Farm outlines: OpenStreetMap volunteers (not ownership, not a for-sale list).
- Climate projections: CMIP6 models via Open-Meteo (not a NASA product).

Simulated or modelled:
- In `app.html`, the "Satellite snapshot", "Recommended rotation" and "Rotation timelapse" panels are simulated demo values and are labelled on screen.
- Yields in the simulator are an index from a simple soil-water model, not tonnes. Crop values and rotation effects are assumptions. Not validated against farm yields.

## Layout

- `js/engine.js` simulation and ranking, `js/stack3d.js` the 3D layer stack, `js/map.js` map, `js/globeapp.js` globe merge.
- `server.py` local server and data proxy, `services.py` data services with a disk cache.
- `fetch_data.py`, `fetch_extras.py` refresh the cached data. `test_engine.mjs` prints each demo region's picks.

## Credits and notices

- `app.html` is a copy of a teammate's globe app with the address search, farm picker and real layers added. Credit the original author here.
- Map imagery: Esri World Imagery and NASA GIBS. Map data: OpenStreetMap contributors (ODbL). Libraries: Leaflet, three.js.
- Decision support for a hackathon demo, not agronomic advice. No licence has been chosen yet.
