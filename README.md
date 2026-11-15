# Field Shift

NASA Space Apps 2026 prototype for the challenge "Field Shift: Adapting Farms with NASA Data".
Pick a place on a globe, type an address, choose a nearby farm, and see its real NASA layers in 3D
(rain, soil moisture, heat, vegetation, water) with NASA's own colour legends. A rotation simulator and a
"replay your past seasons" page are included.

## CropAhead (the main app)

`cropahead.html` is the farmer-facing app: a NASA 3D Earth, type your town, pick your field, then one big answer
("Next season, plant ...") and eight plain-language steps:

1. **From space**: real NASA layers (rain, soil water, ground heat, plant health, water) stacked in 3D, with the reading at your field.
2. **Past crops**: what grew on the field each year (Agriculture and Agri-Food Canada satellite crop map; Canada only).
3. **AI forecast**: the learned season-outlook model (`ml/`), trained on FAOSTAT yields and NASA POWER weather.
4. **Why rotate**: evidence from Ontario long-term trials (University of Guelph), OMAFA 2026 budgets, Bowles et al. 2020; money for your field (Ontario).
5. **Best crops**: crop fit on your soil and NASA weather, with a Today / 2050s switch (NASA NEX-GDDP-CMIP6, 3 models).
6. **Water & fire**: water a crop could use, nearby lakes/rivers (OpenStreetMap), Ontario water-permit rule, 10+ years of NASA FIRMS fires.
7. **Grow it**: 3D simulation of "same crop every year" vs the rotation through the last 4 real seasons.
8. **Where to sell**: Ontario prices (Statistics Canada) and nearby places to contact (OpenStreetMap; not confirmed buyers).

Every number has its source in a "How do we know?" box on the page. Sources and checked figures: `data/rotation.json`.

## Run it

```bash
pip install numpy scikit-learn joblib
python server.py
```

(Only the AI forecast needs these packages; everything else is Python 3 standard library.)
Then open http://localhost:8765/cropahead.html, or one of the older pages:

| Page | What it is |
| --- | --- |
| `cropahead.html` | **CropAhead**, the main app (above). |
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
