# Baltic Trail (Балтийская Тропа)

PWA hiking trail map app. Static site: Leaflet + vanilla JS + Service Worker.

## Deploy

VPS: `72.56.126.111`, Docker container serves `/opt/claude-tg-bot/sandbox/` on port 8099.
Domain: `baltictrail.ru` (nginx + SSL via certbot).

```bash
rsync -avz --delete -e "ssh -i ~/.ssh/vps_key" /Users/anastasiamisenko/Documents/projects/tropy/ root@72.56.126.111:/opt/claude-tg-bot/sandbox/ --exclude='.DS_Store' --exclude='tropa-pwa.zip'
```

Bump `APP_CACHE` version in `sw.js` on every deploy.

## Workflow

After substantial features: commit, push, deploy, and update this CLAUDE.md.

## Structure

- `index.html` — map page with onboarding overlay
- `about.html` — SEO landing page
- `help.html` — user guide
- `js/app.js` — all logic (map, POI, GPS, navigation, onboarding)
- `css/style.css` — styles
- `data/track.gpx` — trail track
- `data/points.geojson` — points of interest
- `sw.js` — service worker (app cache + tile cache)
- `icons/` — logo, favicon, PWA icons

## Key details

- Accent color: blue (`#29b6f6` / `#0288d1`)
- Logo: blue circle with white seagull (wings up)
- Categories: start, history, nature, viewpoint, water, rest, warning, junction, photo, info, other
- Admin mode: `?edit=1803` in URL
- Onboarding: welcome -> geolocation -> install prompt
