# Codex Draft: /opt/baltictrail

Status: `LIVE`.

Role: static PWA hiking trail map app for `baltictrail.ru`.

Important paths:

- Project: `/opt/baltictrail`
- Main page: `index.html`
- SEO/about page: `about.html`
- Help page: `help.html`
- App logic: `js/app.js`
- Styles: `css/style.css`
- Trail data: `data/track.gpx`, `data/points.geojson`
- Service worker: `sw.js`

Safety rules:

- Do not deploy automatically.
- Do not change nginx/certbot without confirmation.
- If changing cached frontend files, remember service worker cache version can affect what users see.
- Do not delete trail data or icons without confirmation.

Safe checks:

```bash
git -C /opt/baltictrail status --short --branch
find /opt/baltictrail -maxdepth 2 -type f | sort
```
