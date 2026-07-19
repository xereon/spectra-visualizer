import { AudioEngine } from './audio-engine.js?v=7';
import { Visualizer } from './visualizer.js?v=7';
import { RazorOverlay } from './razor-overlay.js?v=7';
import { THEMES, applyTheme } from './themes.js?v=7';

// the boot-error banner is shown by default in the HTML; reaching this line
// means modules loaded, so remove it
document.getElementById('bootError')?.remove();

const engine = new AudioEngine();

// WebGL can be unavailable (old GPUs, disabled drivers, sandboxed browsers);
// degrade to audio + the 2D spectrum overlay instead of a dead page
let viz;
try {
  viz = new Visualizer(document.getElementById('scene'));
} catch (err) {
  console.error('3D visuals disabled:', err);
  viz = {
    params: { sceneMode: 'none', hue: 262 },
    setParam(k, v) { this.params[k] = v; },
    update() {},
  };
  const detail = (err && err.message) ? ` (${err.message.slice(0, 80)})` : '';
  setTimeout(() => toast(`3D visuals unavailable${detail} — audio and spectrum still work`), 600);
}
const razor = new RazorOverlay(document.getElementById('razor'));

const el = (id) => document.getElementById(id);
const toastEl = el('toast');
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// ---------------- State ----------------
const state = {
  playlist: [],
  currentIndex: -1,
  shuffle: false,
  repeat: 'off', // off | all | one
  isSeeking: false,
  muted: false,
  lastVolume: 0.8,
  hueOffset: 0,
  currentTheme: THEMES[0],
};

// ---------------- Theme UI ----------------
const themeGrid = el('themeGrid');
THEMES.forEach((t) => {
  const sw = document.createElement('div');
  sw.className = 'theme-swatch';
  sw.style.background = `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]}, ${t.colors[2]})`;
  sw.title = t.name;
  sw.dataset.id = t.id;
  const label = document.createElement('span');
  label.textContent = t.name;
  sw.appendChild(label);
  sw.addEventListener('click', () => selectTheme(t));
  themeGrid.appendChild(sw);
});
function selectTheme(t) {
  state.currentTheme = t;
  [...themeGrid.children].forEach((c) => c.classList.toggle('active', c.dataset.id === t.id));
  applyThemeNow();
}
function applyThemeNow() {
  applyTheme(state.currentTheme, state.hueOffset);
  const effectiveHue = (state.currentTheme.hue + state.hueOffset) % 360;
  viz.setParam('hue', effectiveHue);
  razor.setHue(effectiveHue);
}
selectTheme(THEMES[0]);

el('hueSlider').addEventListener('input', (e) => {
  state.hueOffset = Number(e.target.value);
  el('valHue').textContent = state.hueOffset + '°';
  applyThemeNow();
});

// ---------------- Drawers ----------------
const drawers = { drawerPlaylist: el('drawerPlaylist'), drawerVisuals: el('drawerVisuals'), drawerFx: el('drawerFx') };
const drawerBtns = { drawerPlaylist: el('btnPlaylist'), drawerVisuals: el('btnVisuals'), drawerFx: el('btnFx') };
function toggleDrawer(name) {
  const isOpen = drawers[name].classList.contains('open');
  Object.keys(drawers).forEach((k) => {
    drawers[k].classList.remove('open');
    drawerBtns[k].classList.remove('active');
  });
  if (!isOpen) {
    drawers[name].classList.add('open');
    drawerBtns[name].classList.add('active');
  }
}
el('btnPlaylist').addEventListener('click', () => toggleDrawer('drawerPlaylist'));
el('btnVisuals').addEventListener('click', () => toggleDrawer('drawerVisuals'));
el('btnFx').addEventListener('click', () => toggleDrawer('drawerFx'));
document.querySelectorAll('.closeBtn').forEach((b) => b.addEventListener('click', () => {
  drawers[b.dataset.close].classList.remove('open');
  drawerBtns[b.dataset.close].classList.remove('active');
}));

// ---------------- File loading / playlist ----------------
const dropzone = el('dropzone');
const fileInput = el('fileInput');

function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(f.name));
  if (!files.length) { toast('No supported audio files found'); return; }
  files.forEach((f) => state.playlist.push({ name: f.name.replace(/\.[^.]+$/, ''), file: f }));
  renderPlaylist();
  toast(`Added ${files.length} track${files.length > 1 ? 's' : ''}`);
  if (state.currentIndex === -1) loadTrack(0, true);
}

dropzone.addEventListener('click', (e) => {
  // programmatic fileInput.click() bubbles back up to this handler; don't recurse
  if (e.target === fileInput) return;
  fileInput.click();
});
el('btnAddFiles').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => { addFiles(e.target.files); fileInput.value = ''; });

['dragenter', 'dragover'].forEach((ev) => window.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => {
  e.preventDefault();
  if (ev === 'dragleave' && e.target !== dropzone) return;
  dropzone.classList.remove('dragover');
}));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

function renderPlaylist() {
  const ul = el('playlist');
  ul.innerHTML = '';
  state.playlist.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = i === state.currentIndex ? 'playing' : '';
    const name = document.createElement('span');
    name.className = 'track-name';
    name.textContent = track.name;
    const remove = document.createElement('span');
    remove.className = 'track-remove';
    remove.textContent = '×';
    remove.addEventListener('click', (e) => { e.stopPropagation(); removeTrack(i); });
    li.appendChild(name);
    li.appendChild(remove);
    li.addEventListener('click', () => loadTrack(i, true));
    ul.appendChild(li);
  });
}
function removeTrack(i) {
  state.playlist.splice(i, 1);
  if (i === state.currentIndex) { engine.pause(); state.currentIndex = -1; }
  else if (i < state.currentIndex) state.currentIndex--;
  renderPlaylist();
}

let loadSeq = 0;
async function loadTrack(index, autoplay) {
  const track = state.playlist[index];
  if (!track) return;
  const mySeq = ++loadSeq;
  try {
    const result = await engine.load(track.file);
    // a newer load started while this one was decoding — let it win
    if (result === null || mySeq !== loadSeq) return;
    if (result.mode === 'stream') {
      toast('Long track — streaming mode (tempo works, pitch shift unavailable)');
    }
    state.currentIndex = index;
    renderPlaylist();
    el('trackTitle').textContent = track.name;
    el('trackMeta').textContent = formatTime(engine.duration);
    dropzone.classList.add('hidden');
    updateMediaSession(track.name);
    if (autoplay) {
      const audible = await engine.play();
      updatePlayIcon();
      if (!audible) toast('Audio is blocked by the browser — click anywhere once to enable sound');
    }
  } catch (err) {
    console.error(err);
    toast(`Could not load "${track.name}" — ${err.message || err.name || err}`);
  }
}

// browsers keep a fresh AudioContext suspended until a real user gesture
// (drag-and-drop does not count); resume on the first genuine interaction
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => {
  if (engine.ctx.state === 'suspended') engine.ctx.resume().catch(() => {});
}));

window.addEventListener('error', (e) => {
  toast('Error: ' + (e.message || 'unknown'));
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason && (e.reason.message || String(e.reason));
  toast('Error: ' + msg);
});

// ---------------- Transport ----------------
function formatTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function updatePlayIcon() {
  el('btnPlay').innerHTML = engine.playing ? '&#10074;&#10074;' : '&#9654;';
}
el('btnPlay').addEventListener('click', async () => {
  if (state.currentIndex === -1) { fileInput.click(); return; }
  await engine.togglePlay();
  updatePlayIcon();
});
el('btnPrev').addEventListener('click', () => gotoRelative(-1));
el('btnNext').addEventListener('click', () => gotoRelative(1));

function gotoRelative(dir) {
  if (!state.playlist.length) return;
  let idx;
  if (state.shuffle) {
    if (state.playlist.length === 1) idx = 0;
    else do { idx = Math.floor(Math.random() * state.playlist.length); } while (idx === state.currentIndex);
  } else {
    idx = state.currentIndex + dir;
    if (idx < 0) idx = state.playlist.length - 1;
    if (idx >= state.playlist.length) idx = 0;
  }
  loadTrack(idx, true);
}

el('btnShuffle').addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  el('btnShuffle').classList.toggle('active', state.shuffle);
});
el('btnRepeat').addEventListener('click', () => {
  state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
  const btn = el('btnRepeat');
  btn.classList.toggle('active', state.repeat !== 'off');
  btn.innerHTML = state.repeat === 'one' ? '&#128257;<sub>1</sub>' : '&#128257;';
});

engine.onEndedCb = () => {
  if (state.repeat === 'one') { engine.seekFraction(0); engine.play(); return; }
  if (!state.playlist.length) return;
  if (state.currentIndex === state.playlist.length - 1 && !state.shuffle && state.repeat === 'off') { updatePlayIcon(); return; }
  gotoRelative(1);
};

const seekBar = el('seekBar');
seekBar.addEventListener('mousedown', () => state.isSeeking = true);
seekBar.addEventListener('touchstart', () => state.isSeeking = true);
seekBar.addEventListener('input', () => {
  el('timeCur').textContent = formatTime((seekBar.value / 1000) * engine.duration);
});
function commitSeek() {
  state.isSeeking = false;
  engine.seekFraction(seekBar.value / 1000);
}
seekBar.addEventListener('change', commitSeek);

const volumeBar = el('volumeBar');
volumeBar.addEventListener('input', () => {
  const v = volumeBar.value / 100;
  engine.setVolume(v);
  state.lastVolume = v;
  state.muted = v === 0;
  updateMuteIcon();
});
function updateMuteIcon() { el('btnMute').innerHTML = state.muted || volumeBar.value == 0 ? '&#128263;' : '&#128266;'; }
el('btnMute').addEventListener('click', () => {
  state.muted = !state.muted;
  if (state.muted) { engine.setVolume(0); volumeBar.value = 0; }
  else { engine.setVolume(state.lastVolume || 0.8); volumeBar.value = (state.lastVolume || 0.8) * 100; }
  updateMuteIcon();
});
engine.setVolume(volumeBar.value / 100);

el('btnFullscreen').addEventListener('click', toggleFullscreen);
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  else document.exitFullscreen();
}
document.addEventListener('fullscreenchange', () => {
  el('btnFullscreen').classList.toggle('active', !!document.fullscreenElement);
});

// ---------------- Keyboard shortcuts ----------------
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.code) {
    case 'Space': e.preventDefault(); el('btnPlay').click(); break;
    case 'ArrowRight': if (engine.duration > 0) engine.seekFraction((engine.currentTime + 5) / engine.duration); break;
    case 'ArrowLeft': if (engine.duration > 0) engine.seekFraction((engine.currentTime - 5) / engine.duration); break;
    case 'ArrowUp': e.preventDefault(); volumeBar.value = Math.min(100, +volumeBar.value + 5); volumeBar.dispatchEvent(new Event('input')); break;
    case 'ArrowDown': e.preventDefault(); volumeBar.value = Math.max(0, +volumeBar.value - 5); volumeBar.dispatchEvent(new Event('input')); break;
    case 'KeyN': gotoRelative(1); break;
    case 'KeyB': gotoRelative(-1); break;
    case 'KeyS': el('btnShuffle').click(); break;
    case 'KeyR': el('btnRepeat').click(); break;
    case 'KeyM': el('btnMute').click(); break;
    case 'KeyP': toggleDrawer('drawerPlaylist'); break;
    case 'KeyV': toggleDrawer('drawerVisuals'); break;
    case 'KeyF': toggleDrawer('drawerFx'); break;
    case 'KeyX': el('btnShot').click(); break;
    case 'KeyI': el('btnMic').click(); break;
    case 'Enter': toggleFullscreen(); break;
  }
});

// ---------------- Visuals panel ----------------
function bindRange(id, cb, fmt) {
  const input = el(id);
  const valSpan = el('val' + id.replace('ctl', ''));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (valSpan) valSpan.textContent = fmt ? fmt(v) : v;
    cb(v);
  });
}
function bindGroup(groupId, key, applyFn) {
  document.getElementById(groupId).addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    [...e.currentTarget.children].forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    applyFn(btn.dataset[key]);
  });
}

// true while settings are being applied programmatically (restore, party mode)
let quietSwitch = false;

bindGroup('sceneModeGroup', 'mode', (v) => {
  viz.setParam('sceneMode', v);
  if (v === 'razor' && !quietSwitch && state.currentTheme.id !== 'ocean') {
    selectTheme(THEMES.find((t) => t.id === 'ocean'));
    toast('Ocean theme applied for the classic RAZOR look');
  }
});
bindGroup('cameraModeGroup', 'cam', (v) => viz.setParam('cameraMode', v));
bindGroup('bgModeGroup', 'bg', (v) => viz.setParam('bgMode', v));

bindRange('ctlBloom', (v) => viz.setParam('bloom', v));
bindRange('ctlBrightness', (v) => viz.setParam('brightness', v));
bindRange('ctlParticles', (v) => viz.setParam('particleCount', v));
bindRange('ctlPSize', (v) => viz.setParam('particleSize', v));
bindRange('ctlRotSpeed', (v) => viz.setParam('rotSpeed', v));
bindRange('ctlCamSpeed', (v) => viz.setParam('camSpeed', v));
bindRange('ctlSens', (v) => viz.setParam('sensitivity', v));
bindRange('ctlTrail', (v) => viz.setParam('trail', v));
bindRange('ctlWaveH', (v) => viz.setParam('waveHeight', v));
bindRange('ctlPartials', (v) => razor.setPartials(v));

// ---------------- Audio FX panel ----------------
bindRange('ctlPitch', (v) => engine.setPitchSemitones(v), (v) => `${v > 0 ? '+' : ''}${v} st`);
bindRange('ctlFinePitch', (v) => engine.setFineCents(v), (v) => `${v > 0 ? '+' : ''}${v} ct`);
bindRange('ctlTempo', (v) => engine.setTempoPercent(v), (v) => `${v}%`);
bindRange('ctlFormant', (v) => engine.setFormant(v));
bindRange('ctlBass', (v) => engine.setBass(v), (v) => `${v > 0 ? '+' : ''}${v} dB`);
bindRange('ctlTreble', (v) => engine.setTreble(v), (v) => `${v > 0 ? '+' : ''}${v} dB`);
bindRange('ctlWidth', (v) => engine.setWidth(v), (v) => `${v}%`);
bindRange('ctlReverb', (v) => engine.setReverb(v), (v) => `${v}%`);
bindRange('ctlEcho', (v) => engine.setEcho(v), (v) => `${v}%`);
bindRange('ctlLP', (v) => engine.setLowpass(v), (v) => `${v} Hz`);
bindRange('ctlHP', (v) => engine.setHighpass(v), (v) => `${v} Hz`);
bindRange('ctlComp', (v) => engine.setCompressor(v), (v) => v > 0 ? `${v}%` : 'Off');
el('ctlKeyLock').addEventListener('change', (e) => engine.setKeyLock(e.target.checked));
el('ctlLimiter').addEventListener('change', (e) => engine.setLimiter(e.target.checked));
engine.setLimiter(true);

el('btnResetPitch').addEventListener('click', () => {
  setFxSliders({ pitch: 0, fine: 0, tempo: 100, formant: 0 });
  [...document.getElementById('voicePresets').children].forEach((b) => b.classList.remove('active'));
  document.querySelector('[data-preset="normal"]').classList.add('active');
});

function setFxSliders({ pitch, fine, tempo, formant }) {
  if (pitch !== undefined) { el('ctlPitch').value = pitch; el('ctlPitch').dispatchEvent(new Event('input')); }
  if (fine !== undefined) { el('ctlFinePitch').value = fine; el('ctlFinePitch').dispatchEvent(new Event('input')); }
  if (tempo !== undefined) { el('ctlTempo').value = tempo; el('ctlTempo').dispatchEvent(new Event('input')); }
  if (formant !== undefined) { el('ctlFormant').value = formant; el('ctlFormant').dispatchEvent(new Event('input')); }
}

const VOICE_PRESETS = {
  normal: { pitch: 0, tempo: 100, formant: 0 },
  podcast: { pitch: -2, tempo: 100, formant: -1.5 },
  trailer: { pitch: -5, tempo: 100, formant: -3 },
  cartoon: { pitch: 7, tempo: 100, formant: 4 },
  robot: { pitch: -3, tempo: 100, formant: -6 },
  monster: { pitch: -8, tempo: 100, formant: -5 },
  chipmunk: { pitch: 7, tempo: 100, formant: 3 },
  vinyl: { pitch: -3, tempo: 70, formant: 0 },
};
el('voicePresets').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  [...e.currentTarget.children].forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  const preset = VOICE_PRESETS[btn.dataset.preset];
  setFxSliders({ pitch: preset.pitch, fine: 0, tempo: preset.tempo, formant: preset.formant });
});

// ---------------- Defaults & reset ----------------
const FX_DEFAULTS = {
  ctlPitch: 0, ctlFinePitch: 0, ctlTempo: 100, ctlFormant: 0, ctlBass: 0, ctlTreble: 0,
  ctlWidth: 100, ctlReverb: 0, ctlEcho: 0, ctlLP: 20000, ctlHP: 20, ctlComp: 0,
};
const FX_TOGGLE_DEFAULTS = { ctlKeyLock: true, ctlLimiter: true };
const VIS_DEFAULTS = {
  ctlBloom: 1.2, ctlBrightness: 1.0, ctlParticles: 8000, ctlPSize: 1.4, ctlRotSpeed: 1.0,
  ctlCamSpeed: 1.0, ctlSens: 1.0, ctlTrail: 0.6, ctlWaveH: 1.0, ctlPartials: 48,
};
const VIS_TOGGLE_DEFAULTS = { ctlRazorShow: true };

function setRange(id, v) { const i = el(id); if (!i) return; i.value = v; i.dispatchEvent(new Event('input')); }
function setToggle(id, v) { const i = el(id); if (!i) return; i.checked = v; i.dispatchEvent(new Event('change')); }
function applySettings(ranges, toggles) {
  Object.entries(ranges).forEach(([id, v]) => setRange(id, v));
  Object.entries(toggles).forEach(([id, v]) => setToggle(id, v));
}
function markPreset(name) {
  [...el('voicePresets').children].forEach((b) => b.classList.toggle('active', b.dataset.preset === name));
}

el('btnResetFx').addEventListener('click', () => {
  applySettings(FX_DEFAULTS, FX_TOGGLE_DEFAULTS);
  markPreset('normal');
  toast('All audio FX reset to defaults');
});
el('btnResetVisuals').addEventListener('click', () => {
  applySettings(VIS_DEFAULTS, VIS_TOGGLE_DEFAULTS);
  toast('Visuals reset to defaults');
});

// ---------------- Settings persistence ----------------
const PERSIST_KEY = 'spectra-settings-v1';
let restoring = false;
let saveTimer = null;

function clickGroupBtn(groupId, key, val) {
  const btn = document.querySelector(`#${groupId} [data-${key}="${val}"]`);
  if (btn) btn.click();
}

function saveSettings() {
  if (restoring) return;
  const data = {
    ranges: {}, toggles: {},
    theme: state.currentTheme.id, hue: state.hueOffset, volume: volumeBar.value,
    sceneMode: viz.params.sceneMode, cameraMode: viz.params.cameraMode, bgMode: viz.params.bgMode,
  };
  Object.keys({ ...FX_DEFAULTS, ...VIS_DEFAULTS }).forEach((id) => { data.ranges[id] = el(id).value; });
  Object.keys({ ...FX_TOGGLE_DEFAULTS, ...VIS_TOGGLE_DEFAULTS }).forEach((id) => { data.toggles[id] = el(id).checked; });
  try { localStorage.setItem(PERSIST_KEY, JSON.stringify(data)); } catch (e) {}
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveSettings, 500); }
document.querySelectorAll('.drawer input, #volumeBar').forEach((i) => {
  i.addEventListener('input', scheduleSave);
  i.addEventListener('change', scheduleSave);
});
document.querySelectorAll('.drawer button, .theme-swatch').forEach((b) => b.addEventListener('click', scheduleSave));

(function restoreSettings() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(PERSIST_KEY) || 'null'); } catch (e) {}
  if (!data) return;
  restoring = true;
  quietSwitch = true;
  try {
    Object.entries(data.ranges || {}).forEach(([id, v]) => setRange(id, v));
    Object.entries(data.toggles || {}).forEach(([id, v]) => setToggle(id, v));
    const t = THEMES.find((x) => x.id === data.theme);
    if (t) selectTheme(t);
    if (data.hue !== undefined) setRange('hueSlider', data.hue);
    if (data.volume !== undefined) { volumeBar.value = data.volume; volumeBar.dispatchEvent(new Event('input')); }
    if (data.sceneMode) clickGroupBtn('sceneModeGroup', 'mode', data.sceneMode);
    if (data.cameraMode) clickGroupBtn('cameraModeGroup', 'cam', data.cameraMode);
    if (data.bgMode) clickGroupBtn('bgModeGroup', 'bg', data.bgMode);
  } finally {
    restoring = false;
    quietSwitch = false;
  }
})();

// ---------------- Screenshot ----------------
function saveScreenshot() {
  const scene = el('scene');
  const razorC = el('razor');
  const out = document.createElement('canvas');
  out.width = scene.width;
  out.height = scene.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(scene, 0, 0);
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(razorC, 0, 0, out.width, out.height);
  const a = document.createElement('a');
  a.download = `spectra-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  a.href = out.toDataURL('image/png');
  a.click();
  toast('Screenshot saved');
}
el('btnShot').addEventListener('click', saveScreenshot);

// ---------------- Microphone input ----------------
el('btnMic').addEventListener('click', async () => {
  if (engine.micActive) {
    engine.disableMic();
    el('btnMic').classList.remove('active');
    el('trackTitle').textContent = state.currentIndex >= 0 ? state.playlist[state.currentIndex].name : 'No track loaded';
    toast('Microphone off');
  } else {
    try {
      await engine.enableMic();
      el('btnMic').classList.add('active');
      updatePlayIcon();
      el('trackTitle').textContent = '🎤 Microphone';
      el('trackMeta').textContent = 'live input';
      dropzone.classList.add('hidden');
      toast('Visualizing microphone — track playback paused');
    } catch (err) {
      toast('Microphone unavailable: ' + (err.message || err.name));
    }
  }
});

// ---------------- Party mode ----------------
const PARTY_MODES = ['razor', 'tunnel', 'rings', 'particles', 'crystal', 'waveform', 'cubes', 'terrain', 'nova', 'galaxy', 'scope'];
let partyTimer = null;
el('ctlParty').addEventListener('change', (e) => {
  clearInterval(partyTimer);
  partyTimer = null;
  if (e.target.checked) {
    partyTimer = setInterval(() => {
      let next;
      do { next = PARTY_MODES[Math.floor(Math.random() * PARTY_MODES.length)]; } while (next === viz.params.sceneMode);
      quietSwitch = true;
      clickGroupBtn('sceneModeGroup', 'mode', next);
      quietSwitch = false;
    }, 18000);
    if (!restoring) toast('Party mode — scene changes every 18 seconds');
  }
});

// ---------------- Auto-hide UI while playing ----------------
let idleTimer = null;
function uiIdle() {
  if (engine.playing || engine.micActive) document.body.classList.add('ui-hidden');
}
function uiWake() {
  document.body.classList.remove('ui-hidden');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(uiIdle, 3500);
}
['mousemove', 'pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, uiWake, { passive: true }));
uiWake();

// ---------------- OS media keys ----------------
function updateMediaSession(name) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: name, artist: 'SPECTRA' });
  } catch (e) {}
}
if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('play', () => { engine.play(); updatePlayIcon(); });
    navigator.mediaSession.setActionHandler('pause', () => { engine.pause(); updatePlayIcon(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => gotoRelative(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => gotoRelative(1));
  } catch (e) {}
}

window.SPECTRA = { engine, viz, razor, state };

// ---------------- Main loop ----------------
let lastFpsTime = performance.now();
let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);
  const analysis = engine.analyze();
  viz.update(analysis);
  // the 2D spectrum overlay competes with the razor line-field scene; keep it off there
  razor.setShow(el('ctlRazorShow').checked && viz.params.sceneMode !== 'razor');
  razor.draw(analysis);

  if (!state.isSeeking) {
    const dur = engine.duration || 0;
    const cur = engine.currentTime || 0;
    if (dur > 0) seekBar.value = Math.round((cur / dur) * 1000);
    el('timeCur').textContent = formatTime(cur);
    el('timeDur').textContent = formatTime(dur);
  }

  el('hudBpm').textContent = analysis.bpm || '--';
  el('hudBass').textContent = Math.round(analysis.bass * 100);
  el('hudMid').textContent = Math.round(analysis.mid * 100);
  el('hudTreble').textContent = Math.round(analysis.treble * 100);

  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime > 1000) {
    el('fps').textContent = `${Math.round((frameCount * 1000) / (now - lastFpsTime))} FPS`;
    frameCount = 0;
    lastFpsTime = now;
  }
}
animate();
