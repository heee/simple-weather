# Simple Weather

A single-page iPhone home-screen web app: current temperature, today, rain, a 7-day forecast, and whether the sky is clear for stargazing.

- Opens instantly from the last saved forecast (localStorage), then refreshes in the background.
- Works offline: a service worker caches the app shell; SunCalc and the Manrope font are vendored.
- Data from [Open-Meteo](https://open-meteo.com/) (no API key). Moon and twilight times computed on the device with [SunCalc](https://github.com/mourner/suncalc).

## Install on iPhone

Open the GitHub Pages URL in Safari → Share → **Add to Home Screen**.

## Develop

No build step. Serve the folder with any static server, for example:

```
python -m http.server 8765
```

Run the stargazing checks (verified against USNO almanac values for Houston):

```
node tests/stars.test.js
```

When you change any shell file, bump `VERSION` in `sw.js` so installed copies pick it up.

## Files

- `index.html`, `styles.css` — layout and light/dark themes
- `logic.js` — forecast model and stargazing verdicts (no DOM; also runs in Node)
- `app.js` — rendering, caching, places, refresh
- `sw.js`, `manifest.json`, `icons/` — PWA
- `vendor/suncalc.js` (BSD-2), `fonts/manrope.woff2` (OFL)
