export const THEMES = [
  { id: 'cyber',     name: 'Cyber Neon', hue: 262, sat: 85, colors: ['#7c3aed', '#22d3ee', '#4f46e5'] },
  { id: 'inferno',   name: 'Inferno',    hue: 18,  sat: 90, colors: ['#ff4500', '#ffb800', '#ff0033'] },
  { id: 'ocean',     name: 'Ocean',      hue: 190, sat: 80, colors: ['#00c9ff', '#0072ff', '#e0ffff'] },
  { id: 'matrix',    name: 'Matrix',     hue: 120, sat: 90, colors: ['#00ff41', '#003b00', '#00ff41'] },
  { id: 'rainbow',   name: 'Rainbow',    hue: 0,   sat: 90, colors: ['#ff0000', '#00ff00', '#0000ff'], cycle: true },
  { id: 'crystal',   name: 'Crystal',    hue: 200, sat: 20, colors: ['#e8f4ff', '#a0d8ff', '#ffffff'] },
  { id: 'vaporwave', name: 'Vaporwave',  hue: 320, sat: 85, colors: ['#ff6ec7', '#8a5cff', '#00e5ff'] },
  { id: 'dark',      name: 'Dark Mode',  hue: 0,   sat: 0,  colors: ['#00ff88', '#111111', '#00ff88'] },
];

export function applyTheme(theme, hueOffset = 0) {
  const root = document.documentElement;
  root.style.setProperty('--hue', (theme.hue + hueOffset) % 360);
  root.style.setProperty('--sat', theme.sat + '%');
}
