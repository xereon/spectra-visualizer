# TELLY — Live English TV

Mobile-first IPTV browser for ~2,900 free English-language channels, built as a
static web app — no build step, no backend.

**Data:** the open-source [iptv-org](https://github.com/iptv-org/iptv) playlists,
fetched client-side (CORS-enabled):

- `languages/eng.m3u` — every English-language channel
- `countries/au.m3u` — merged in so all 🇦🇺 Australian channels are guaranteed

## Features

- **Auto-categorized** — 27 categories (News, Sports, Movies, Kids…) parsed from
  the playlist's `group-title`; "Undefined" channels are rescued via keyword rules.
  Religious channels are excluded (by playlist category and by name keywords)
- **Three view modes** — card grid, dense logo wall, detailed list
- **Zoomable thumbnails** — pinch the grid on touch, or use the toolbar slider
- **Country filter** with flags (parsed from `tvg-id`), search, favorites (localStorage)
- **In-app player** — hls.js with retry/error handling, native HLS on iOS,
  related-channels rail, copy-URL fallback for VLC
- Lazy-loaded logos with generated initial placeholders, infinite scroll,
  12-hour channel cache, collapsing toolbar on scroll

## Running

Serve the repo over HTTP and open `/iptv/`:

```bash
python3 -m http.server 8877   # http://localhost:8877/iptv/
```

Note: streams come from public broadcasters — some are offline or geo-blocked.
