# SPECTRA — Audio-Reactive 3D Music Visualizer

A browser-based MP3 player with a GPU-accelerated 3D visualizer, inspired by the
Native Instruments RAZOR additive-synthesis display, MilkDrop, and Trap-Nation-style
visuals. No build step — plain ES modules served over HTTP.

![status](https://img.shields.io/badge/runtime-browser-blue)

## Features

### Player
- Drag & drop or file-picker loading (MP3 / WAV / FLAC / OGG / M4A)
- Playlist with shuffle, repeat (off / all / one), seek, volume, mute
- Fullscreen immersive mode with auto-hiding UI
- Keyboard shortcuts (Space, arrows, N/B/S/R/M/P/V/F/X/I, Enter)
- OS media-key support
- Microphone input mode — visualize any live audio

### Visualizer (Three.js + WebGL2)
11 scene modes: **Razor Waves** (NI RAZOR-style harmonic line field), Tunnel, Rings,
Particles, Crystal, Waveform, Cube Field, Terrain, Nova, Galaxy, Scope.

- Unreal bloom + afterimage trail post-processing
- 4 camera modes (auto orbit, flythrough, free drag, top down)
- 4 backgrounds (deep space, grid, matrix rain, black)
- 8 themes + live hue slider recoloring everything in real time
- RAZOR-style 2D additive-spectrum overlay with scrolling waterfall
- Party mode (auto-cycles scenes), FPS counter, PNG screenshot export
- Beat detection and rough BPM estimate drive pulses across every mode

### Audio FX (Web Audio + SoundTouchJS)
- **Independent pitch & tempo** (WSOLA time-stretching): pitch ±12 semitones with
  fine cents, tempo 50–200%, key lock
- Voice presets: Podcast, Movie Trailer, Cartoon, Robot, Monster, Chipmunk, Vinyl
- Formant/vocal-depth tilt, bass & treble shelves, stereo width (mid/side)
- Reverb (generated impulse response), echo, low/high-pass filters
- Compressor and limiter
- One-click **Reset to defaults** for all FX and all visual settings
- Every setting persists between sessions (localStorage)

## Running

Serve the folder over HTTP (ES modules don't work from `file://`):

```bash
python3 -m http.server 8877
# then open http://localhost:8877
```

Internet is required on first load (Three.js and fonts come from CDN).
SoundTouchJS is vendored in `vendor/`.

## Structure

```
index.html            UI shell
css/style.css         neon theme, drawers, transport
js/main.js            wiring: player, playlist, panels, persistence
js/audio-engine.js    Web Audio graph, pitch/tempo, FX chain, analysis
js/visualizer.js      Three.js scenes, cameras, post-processing
js/razor-overlay.js   2D additive-spectrum overlay
js/themes.js          theme definitions
vendor/soundtouch.js  SoundTouchJS (WSOLA pitch/tempo DSP)
```
