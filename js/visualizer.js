import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

function noise3(x, y, z, t) {
  return (
    Math.sin(x * 1.3 + t) * Math.cos(y * 1.7 - t * 0.7) +
    Math.sin(y * 0.9 - t * 1.1) * Math.cos(z * 1.5 + t * 0.5) +
    Math.sin(z * 1.1 + t * 0.8)
  ) / 3;
}

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.params = {
      sceneMode: 'tunnel',
      cameraMode: 'auto',
      bgMode: 'space',
      bloom: 1.2,
      brightness: 1.0,
      particleCount: 8000,
      particleSize: 1.4,
      rotSpeed: 1.0,
      camSpeed: 1.0,
      sensitivity: 1.0,
      trail: 0.6,
      waveHeight: 1.0,
      hue: 262,
    };
    this.clock = new THREE.Clock();
    this._smoothBass = 0; this._smoothMid = 0; this._smoothTreble = 0; this._smoothEnergy = 0;
    this._beatPulse = 0;

    this._initThree();
    this._initPostFX();
    this._initBackground();
    this._initSceneModes();
    this._initControls();
    window.addEventListener('resize', () => this._onResize());
  }

  _initThree() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.params.brightness;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05050a, 0.012);

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.set(0, 4, 20);

    this.scene.add(new THREE.AmbientLight(0x404060, 1.2));
    const pl = new THREE.PointLight(0xffffff, 2, 200);
    pl.position.set(0, 20, 20);
    this.scene.add(pl);

    this._camT = 0;
  }

  _initPostFX() {
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.afterimagePass = new AfterimagePass();
    this.afterimagePass.uniforms['damp'].value = this.params.trail;
    this.composer.addPass(this.afterimagePass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), this.params.bloom, 0.55, 0.15);
    this.composer.addPass(this.bloomPass);

    this.composer.addPass(new OutputPass());
  }

  _theme() {
    const h = this.params.hue / 360;
    return {
      c1: new THREE.Color().setHSL(h, 0.85, 0.6),
      c2: new THREE.Color().setHSL((h + 0.12) % 1, 0.85, 0.55),
      c3: new THREE.Color().setHSL((h - 0.15 + 1) % 1, 0.8, 0.6),
    };
  }

  // ---------------- Background ----------------
  _initBackground() {
    this.bgGroup = new THREE.Group();
    this.scene.add(this.bgGroup);

    // starfield
    const starCount = 3000;
    const starGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 200 + Math.random() * 600;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, transparent: true, opacity: 0.7, sizeAttenuation: true });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.bgGroup.add(this.stars);

    // grid
    this.grid = new THREE.GridHelper(800, 80, 0x4444ff, 0x222244);
    this.grid.position.y = -30;
    this.gridMat1 = this.grid.material;
    this.bgGroup.add(this.grid);

    // matrix rain
    const rainCount = 600;
    const rainGeo = new THREE.BufferGeometry();
    const rainPos = new Float32Array(rainCount * 3);
    this._rainSpeed = new Float32Array(rainCount);
    for (let i = 0; i < rainCount; i++) {
      rainPos[i * 3] = (Math.random() - 0.5) * 300;
      rainPos[i * 3 + 1] = Math.random() * 200 - 50;
      rainPos[i * 3 + 2] = (Math.random() - 0.5) * 300;
      this._rainSpeed[i] = 20 + Math.random() * 40;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    this.rainMat = new THREE.PointsMaterial({ color: 0x00ff44, size: 2.2, transparent: true, opacity: 0.85, sizeAttenuation: true });
    this.rain = new THREE.Points(rainGeo, this.rainMat);
    this.bgGroup.add(this.rain);

    this._applyBgVisibility();
  }

  _applyBgVisibility() {
    this.stars.visible = this.params.bgMode === 'space';
    this.grid.visible = this.params.bgMode === 'grid';
    this.rain.visible = this.params.bgMode === 'matrix';
    this.scene.fog.density = this.params.bgMode === 'black' ? 0.02 : 0.012;
  }

  // ---------------- Scene modes ----------------
  _initSceneModes() {
    this.modeGroup = new THREE.Group();
    this.scene.add(this.modeGroup);

    this._initTunnel();
    this._initRings();
    this._initParticles();
    this._initCrystal();
    this._initWaveform();
    this._initRazor();
    this._initCubes();
    this._initTerrain();
    this._initNova();
    this._initGalaxy();
    this._initScope();

    this._applyModeVisibility();
  }

  _applyModeVisibility() {
    const m = this.params.sceneMode;
    this.tunnelGroup.visible = m === 'tunnel';
    this.ringsGroup.visible = m === 'rings';
    this.particlesPoints.visible = m === 'particles';
    this.crystalGroup.visible = m === 'crystal';
    this.waveformMesh.visible = m === 'waveform';
    this.razorGroup.visible = m === 'razor';
    this.cubesMesh.visible = m === 'cubes';
    this.terrainGroup.visible = m === 'terrain';
    this.novaGroup.visible = m === 'nova';
    this.galaxyPoints.visible = m === 'galaxy';
    this.scopeGroup.visible = m === 'scope';
  }

  _initTunnel() {
    this.tunnelGroup = new THREE.Group();
    this.modeGroup.add(this.tunnelGroup);
    this.tunnelCount = 40;
    this.tunnelSpacing = 12;
    this.tunnelLength = this.tunnelCount * this.tunnelSpacing;
    this.tunnelRings = [];
    for (let i = 0; i < this.tunnelCount; i++) {
      const geo = new THREE.TorusGeometry(7, 0.12, 8, 28);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = -i * this.tunnelSpacing;
      mesh.userData.baseZ = -i * this.tunnelSpacing;
      this.tunnelGroup.add(mesh);
      this.tunnelRings.push(mesh);
    }
  }

  _initRings() {
    this.ringsGroup = new THREE.Group();
    this.modeGroup.add(this.ringsGroup);
    this.ringBarCount = 64;
    this.ringBars = [];
    const geo = new THREE.BoxGeometry(0.35, 1, 0.35);
    for (let i = 0; i < this.ringBarCount; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
      const mesh = new THREE.Mesh(geo, mat);
      const angle = (i / this.ringBarCount) * Math.PI * 2;
      const radius = 9;
      mesh.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      mesh.userData.angle = angle;
      mesh.userData.radius = radius;
      this.ringsGroup.add(mesh);
      this.ringBars.push(mesh);
    }
  }

  _initParticles() {
    this.particleBase = null;
    this._rebuildParticles();
  }

  _rebuildParticles() {
    if (this.particlesPoints) {
      this.modeGroup.remove(this.particlesPoints);
      this.particlesPoints.geometry.dispose();
      this.particlesPoints.material.dispose();
    }
    const count = this.params.particleCount;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const base = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 4 + Math.random() * 14;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      base[i * 3] = x; base[i * 3 + 1] = y; base[i * 3 + 2] = z;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      col[i * 3] = 1; col[i * 3 + 1] = 1; col[i * 3 + 2] = 1;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.particleBase = base;
    const mat = new THREE.PointsMaterial({
      size: this.params.particleSize, vertexColors: true, transparent: true,
      opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.particlesPoints = new THREE.Points(geo, mat);
    this.particlesPoints.visible = this.params.sceneMode === 'particles';
    this.modeGroup.add(this.particlesPoints);
  }

  _initCrystal() {
    this.crystalGroup = new THREE.Group();
    this.modeGroup.add(this.crystalGroup);
    const geo = new THREE.IcosahedronGeometry(6, 3);
    this.crystalBasePos = geo.attributes.position.array.slice();
    const edges = new THREE.EdgesGeometry(geo, 1);
    this.crystalGeo = geo;
    this.crystalWire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    this.crystalSolid = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x112244, transparent: true, opacity: 0.18, shininess: 100, side: THREE.DoubleSide }));
    this.crystalGroup.add(this.crystalSolid);
    this.crystalGroup.add(this.crystalWire);

    const orbCount = 400;
    const orbGeo = new THREE.BufferGeometry();
    const orbPos = new Float32Array(orbCount * 3);
    for (let i = 0; i < orbCount; i++) {
      const r = 10 + Math.random() * 4;
      const theta = Math.random() * Math.PI * 2;
      orbPos[i * 3] = Math.cos(theta) * r;
      orbPos[i * 3 + 1] = (Math.random() - 0.5) * 6;
      orbPos[i * 3 + 2] = Math.sin(theta) * r;
    }
    orbGeo.setAttribute('position', new THREE.BufferAttribute(orbPos, 3));
    this.crystalOrbit = new THREE.Points(orbGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.crystalGroup.add(this.crystalOrbit);
  }

  _initWaveform() {
    this.waveRows = 64;
    this.waveCols = 48;
    const geo = new THREE.PlaneGeometry(40, 60, this.waveCols - 1, this.waveRows - 1);
    geo.rotateX(-Math.PI / 2);
    this.waveGeo = geo;
    const colorAttr = new Float32Array(geo.attributes.position.count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.85, vertexColors: true });
    this.waveformMesh = new THREE.Mesh(geo, mat);
    this.waveformMesh.position.y = -6;
    this.waveformMesh.position.z = -8;
    this.modeGroup.add(this.waveformMesh);
    this._waveHistory = new Array(this.waveRows).fill(null).map(() => new Float32Array(this.waveCols));
  }

  _initRazor() {
    // NI RAZOR-style additive display: one glowing line per harmonic partial,
    // running into the distance, vertical displacement = that partial's
    // amplitude history. Low partials get wide spacing and tall smooth waves;
    // high partials pack into a dense bright comb (log spacing).
    this.razorGroup = new THREE.Group();
    this.modeGroup.add(this.razorGroup);
    this.razorN = 90;
    this.razorH = 150;
    this.razorLines = [];
    this.razorHist = [];
    this._razorSmooth = new Float32Array(this.razorN);
    const width = 64;
    const reflMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false });
    this.razorRefl = new THREE.Group();
    this.razorRefl.scale.y = -0.32;
    this.razorRefl.position.y = -0.4;
    for (let i = 0; i < this.razorN; i++) {
      const frac = i / (this.razorN - 1);
      const x = -width / 2 + width * Math.pow(frac, 0.62);
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(this.razorH * 3);
      for (let j = 0; j < this.razorH; j++) {
        pos[j * 3] = x;
        pos[j * 3 + 1] = 0;
        pos[j * 3 + 2] = 12 - j * 0.6;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.userData.frac = frac;
      this.razorGroup.add(line);
      this.razorLines.push(line);
      this.razorHist.push(new Float32Array(this.razorH));
      this.razorRefl.add(new THREE.Line(geo, reflMat));
    }
    this.razorGroup.add(this.razorRefl);
  }

  _initCubes() {
    this.cubeCols = 40;
    this.cubeRows = 26;
    const geo = new THREE.BoxGeometry(1.1, 1, 1.1);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85 });
    this.cubesMesh = new THREE.InstancedMesh(geo, mat, this.cubeCols * this.cubeRows);
    this.cubesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._cubeDummy = new THREE.Object3D();
    this._cubeHist = new Array(this.cubeRows).fill(null).map(() => new Float32Array(this.cubeCols));
    this._cubeScroll = 0;
    this.modeGroup.add(this.cubesMesh);
  }

  _initTerrain() {
    // spectrogram landscape: frequency across X, history scrolling away in Z
    this.terrainCols = 56;
    this.terrainRows = 70;
    const geo = new THREE.PlaneGeometry(90, 130, this.terrainCols - 1, this.terrainRows - 1);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    this.terrainGeo = geo;
    const solid = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.85,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ wireframe: true, vertexColors: true, transparent: true, opacity: 0.9 }));
    this.terrainGroup = new THREE.Group();
    this.terrainGroup.add(solid);
    this.terrainGroup.add(wire);
    this.terrainGroup.position.set(0, -9, -25);
    this.modeGroup.add(this.terrainGroup);
    this._terrainHist = new Array(this.terrainRows).fill(null).map(() => new Float32Array(this.terrainCols));
    this._terrainScroll = 0;
  }

  _initNova() {
    // radial frequency burst: spikes on a fibonacci sphere around a pulsing core
    this.novaGroup = new THREE.Group();
    this.modeGroup.add(this.novaGroup);
    this.novaSpikes = 180;
    this.novaR0 = 4;
    this._novaDirs = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < this.novaSpikes; i++) {
      const y = 1 - (i / (this.novaSpikes - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      this._novaDirs.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
    }
    const pos = new Float32Array(this.novaSpikes * 2 * 3);
    const col = new Float32Array(this.novaSpikes * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.novaLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.novaGroup.add(this.novaLines);
    this.novaCore = new THREE.Mesh(
      new THREE.IcosahedronGeometry(this.novaR0 * 0.75, 1),
      new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.8 })
    );
    this.novaGroup.add(this.novaCore);
  }

  _initGalaxy() {
    this.galaxyCount = 6000;
    this._galaxySeed = new Float32Array(this.galaxyCount);
    for (let i = 0; i < this.galaxyCount; i++) this._galaxySeed[i] = Math.random() * Math.PI * 2;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.galaxyCount * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.galaxyCount * 3), 3));
    this.galaxyPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 1.1, vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.modeGroup.add(this.galaxyPoints);
    this._galaxyAngle = 0;
  }

  _initScope() {
    // circular oscilloscope: the time-domain waveform bent into a spinning ring
    this.scopeGroup = new THREE.Group();
    this.modeGroup.add(this.scopeGroup);
    this.scopeN = 512;
    const mkRing = () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.scopeN * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.scopeN * 3), 3));
      return new THREE.LineLoop(geo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
    };
    this.scopeOuter = mkRing();
    this.scopeInner = mkRing();
    this.scopeInner.rotation.z = Math.PI / 2;
    this.scopeGroup.add(this.scopeOuter);
    this.scopeGroup.add(this.scopeInner);
  }

  // ---------------- Controls ----------------
  _initControls() {
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.06;
    this.orbit.enabled = false;
    this.orbit.minDistance = 4;
    this.orbit.maxDistance = 300;
  }

  setParam(key, value) {
    this.params[key] = value;
    if (key === 'particleCount') this._rebuildParticles();
    if (key === 'sceneMode') this._applyModeVisibility();
    if (key === 'bgMode') this._applyBgVisibility();
    if (key === 'bloom') this.bloomPass.strength = value;
    if (key === 'brightness') this.renderer.toneMappingExposure = value;
    if (key === 'trail') this.afterimagePass.uniforms['damp'].value = value;
    if (key === 'cameraMode') {
      this.orbit.enabled = value === 'free';
      if (value !== 'free') { this.camera.position.set(0, 4, 20); }
    }
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }

  // ---------------- Frame update ----------------
  update(analysis) {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const p = this.params;
    const sens = p.sensitivity;
    const { bass, mid, treble, energy, isBeat, freqData, timeData } = analysis;

    this._smoothBass += (bass - this._smoothBass) * 0.25;
    this._smoothMid += (mid - this._smoothMid) * 0.25;
    this._smoothTreble += (treble - this._smoothTreble) * 0.25;
    this._smoothEnergy += (energy - this._smoothEnergy) * 0.15;
    this._beatPulse *= 0.9;
    if (isBeat) this._beatPulse = 1;

    const theme = this._theme();
    this._updateColors(theme);

    this.bgGroup.rotation.y += dt * 0.01 * p.rotSpeed;
    if (this.rain.visible) {
      const rp = this.rain.geometry.attributes.position.array;
      for (let i = 0; i < this._rainSpeed.length; i++) {
        rp[i * 3 + 1] -= this._rainSpeed[i] * dt * (1 + this._smoothBass);
        if (rp[i * 3 + 1] < -60) rp[i * 3 + 1] = 140;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    this._updateCamera(dt, t);
    this._updateTunnel(dt, freqData, sens);
    this._updateRings(dt, t, freqData, sens);
    this._updateParticles(dt, t, sens);
    this._updateCrystal(dt, t, sens);
    this._updateWaveform(dt, timeData, sens);
    this._updateRazor(dt, t, freqData, sens);
    this._updateCubes(dt, freqData, sens);
    this._updateTerrain(dt, freqData, sens);
    this._updateNova(dt, t, freqData, sens);
    this._updateGalaxy(dt, t, sens);
    this._updateScope(dt, t, timeData, sens);

    this.orbit.update();
    this.composer.render();
  }

  _updateColors(theme) {
    const set = (obj, color, op) => { if (obj) { obj.material.color.copy(color); if (op !== undefined) obj.material.opacity = op; } };
    this.tunnelRings.forEach((r, i) => r.material.color.copy(i % 2 === 0 ? theme.c1 : theme.c2));
    this.ringBars.forEach((r, i) => r.material.color.copy(i % 3 === 0 ? theme.c3 : theme.c1));
    this.crystalWire.material.color.copy(theme.c1);
    this.crystalSolid.material.color.copy(theme.c2);
    this.waveformMesh.material.color.copy(theme.c1);
    this.rainMat.color.copy(theme.c1);
  }

  _updateCamera(dt, t) {
    const p = this.params;
    if (p.cameraMode === 'auto' && p.sceneMode === 'razor') {
      // low oblique drift across the line field, like the RAZOR promo shots
      this._camT += dt * 0.1 * p.camSpeed;
      const ct = this._camT;
      this.camera.position.set(-34 + Math.sin(ct) * 8, 7.5 + Math.sin(ct * 0.6) * 2.5, 22 + Math.cos(ct * 0.8) * 6);
      this.camera.lookAt(20, 1, -30);
    } else if (p.cameraMode === 'auto') {
      this._camT += dt * 0.15 * p.camSpeed;
      this.camera.position.x = Math.sin(this._camT) * 22;
      this.camera.position.z = Math.cos(this._camT) * 22 + 4;
      this.camera.position.y = 4 + Math.sin(this._camT * 0.5) * 3;
      this.camera.lookAt(0, 0, 0);
    } else if (p.cameraMode === 'flythrough') {
      this._camT += dt * 12 * p.camSpeed;
      this.camera.position.set(Math.sin(t * 0.3) * 1.5, Math.cos(t * 0.4) * 1.2, -this._camT % this.tunnelLength + 30);
      this.camera.lookAt(this.camera.position.x * 0.5, this.camera.position.y * 0.5, this.camera.position.z - 20);
    } else if (p.cameraMode === 'top') {
      this._camT += dt * 0.1 * p.camSpeed;
      this.camera.position.set(Math.sin(this._camT) * 4, 34, Math.cos(this._camT) * 4);
      this.camera.lookAt(0, 0, 0);
    }
    // 'free' handled by OrbitControls
  }

  _updateTunnel(dt, freqData, sens) {
    if (!this.tunnelGroup.visible) return;
    const camZ = this.camera.position.z;
    const half = this.tunnelLength / 2;
    for (let i = 0; i < this.tunnelRings.length; i++) {
      const ring = this.tunnelRings[i];
      let z = ((ring.userData.baseZ - camZ + half) % this.tunnelLength + this.tunnelLength) % this.tunnelLength - half + camZ;
      ring.position.z = z;
      const bin = Math.floor((i / this.tunnelRings.length) * freqData.length * 0.5);
      const amp = (freqData[bin] || 0) / 255;
      const s = 1 + amp * sens * 0.8 + this._beatPulse * 0.3;
      ring.scale.set(s, s, 1);
      ring.rotation.z += dt * (0.2 + amp * 0.5) * this.params.rotSpeed;
      ring.material.opacity = 0.35 + amp * 0.6;
    }
  }

  _updateRings(dt, t, freqData, sens) {
    if (!this.ringsGroup.visible) return;
    this.ringsGroup.rotation.y += dt * 0.12 * this.params.rotSpeed;
    for (let i = 0; i < this.ringBars.length; i++) {
      const bar = this.ringBars[i];
      const bin = Math.floor((i / this.ringBars.length) * freqData.length * 0.7);
      const amp = (freqData[bin] || 0) / 255;
      const h = 0.4 + amp * sens * 9 + this._beatPulse * 1.5;
      bar.scale.y = h;
      bar.position.y = h / 2 - 2;
      bar.material.opacity = 0.5 + amp * 0.5;
    }
  }

  _updateParticles(dt, t, sens) {
    if (!this.particlesPoints.visible) return;
    const pos = this.particlesPoints.geometry.attributes.position.array;
    const col = this.particlesPoints.geometry.attributes.color.array;
    const base = this.particleBase;
    const theme = this._theme();
    const pulse = 1 + this._smoothBass * sens * 0.9 + this._beatPulse * 0.5;
    for (let i = 0; i < pos.length / 3; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      const n = noise3(bx * 0.08, by * 0.08, bz * 0.08, t * 0.4) * (1 + this._smoothTreble * sens * 2);
      pos[i * 3] = bx * pulse + n * 1.5;
      pos[i * 3 + 1] = by * pulse + n * 1.5;
      pos[i * 3 + 2] = bz * pulse + n * 1.5;
      const mixv = (Math.sin(bx * 0.3 + t) + 1) / 2;
      const c = theme.c1.clone().lerp(theme.c2, mixv);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    this.particlesPoints.geometry.attributes.position.needsUpdate = true;
    this.particlesPoints.geometry.attributes.color.needsUpdate = true;
    this.particlesPoints.rotation.y += dt * 0.08 * this.params.rotSpeed;
    this.particlesPoints.material.size = this.params.particleSize * (1 + this._beatPulse * 0.4);
  }

  _updateCrystal(dt, t, sens) {
    if (!this.crystalGroup.visible) return;
    this.crystalGroup.rotation.y += dt * 0.25 * this.params.rotSpeed;
    this.crystalGroup.rotation.x = Math.sin(t * 0.2) * 0.2;
    const posAttr = this.crystalGeo.attributes.position;
    const arr = posAttr.array;
    const bp = this.crystalBasePos;
    for (let i = 0; i < arr.length / 3; i++) {
      const bx = bp[i * 3], by = bp[i * 3 + 1], bz = bp[i * 3 + 2];
      const len = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
      const nx = bx / len, ny = by / len, nz = bz / len;
      const d = 1 + (this._smoothBass * sens * 0.5 + this._smoothTreble * sens * 0.3 + this._beatPulse * 0.3) * noise3(nx * 2, ny * 2, nz * 2, t);
      arr[i * 3] = bx * d; arr[i * 3 + 1] = by * d; arr[i * 3 + 2] = bz * d;
    }
    posAttr.needsUpdate = true;
    this.crystalGeo.computeVertexNormals();
    const newEdges = new THREE.EdgesGeometry(this.crystalGeo, 1);
    this.crystalWire.geometry.dispose();
    this.crystalWire.geometry = newEdges;
    this.crystalOrbit.rotation.y -= dt * 0.4 * this.params.rotSpeed;
  }

  _updateRazor(dt, t, freqData, sens) {
    if (!this.razorGroup.visible) return;
    const N = this.razorN, H = this.razorH;
    const hue = this.params.hue / 360;
    for (let i = 0; i < N; i++) {
      const line = this.razorLines[i];
      const frac = line.userData.frac;
      // log-map partial index to frequency bins so lows spread out
      const bin = 2 + Math.floor(Math.pow(frac, 1.7) * freqData.length * 0.45);
      const raw = (freqData[bin] || 0) / 255;
      this._razorSmooth[i] += (raw - this._razorSmooth[i]) * 0.4;
      const hist = this.razorHist[i];
      hist.copyWithin(1, 0, H - 1);
      hist[0] = this._razorSmooth[i];

      const heightScale = (11 - frac * 7) * this.params.waveHeight * sens;
      const posArr = line.geometry.attributes.position.array;
      for (let j = 0; j < H; j++) {
        const a = hist[j];
        const wiggle = Math.sin(j * 0.32 - t * 2.4 + i * 0.55) * a * 1.8 * (1 - frac * 0.55);
        posArr[j * 3 + 1] = a * heightScale + wiggle + this._beatPulse * a * 1.2;
      }
      line.geometry.attributes.position.needsUpdate = true;
      const amp = this._razorSmooth[i];
      line.material.opacity = Math.min(0.9, 0.2 + amp * 0.7);
      line.material.color.setHSL(hue, 0.6, 0.5 + amp * 0.22);
    }
    this.razorGroup.rotation.y = Math.sin(t * 0.05) * 0.04 * this.params.rotSpeed;
  }

  _updateCubes(dt, freqData, sens) {
    if (!this.cubesMesh.visible) return;
    this._cubeScroll += dt * 9;
    if (this._cubeScroll > 1) {
      this._cubeScroll = 0;
      this._cubeHist.pop();
      const row = new Float32Array(this.cubeCols);
      for (let c = 0; c < this.cubeCols; c++) {
        const bin = 2 + Math.floor(Math.pow(c / (this.cubeCols - 1), 1.6) * freqData.length * 0.5);
        row[c] = (freqData[bin] || 0) / 255;
      }
      this._cubeHist.unshift(row);
    }
    const dummy = this._cubeDummy;
    const theme = this._theme();
    const tmpColor = new THREE.Color();
    let idx = 0;
    for (let r = 0; r < this.cubeRows; r++) {
      const row = this._cubeHist[r];
      for (let c = 0; c < this.cubeCols; c++) {
        const h = 0.15 + row[c] * sens * 10 + this._beatPulse * 0.8;
        dummy.position.set((c - this.cubeCols / 2) * 1.5, h / 2 - 5, 8 - r * 1.9);
        dummy.scale.set(1, h, 1);
        dummy.updateMatrix();
        this.cubesMesh.setMatrixAt(idx, dummy.matrix);
        tmpColor.copy(theme.c2).lerp(theme.c1, Math.min(1, h / 8));
        this.cubesMesh.setColorAt(idx, tmpColor);
        idx++;
      }
    }
    this.cubesMesh.instanceMatrix.needsUpdate = true;
    if (this.cubesMesh.instanceColor) this.cubesMesh.instanceColor.needsUpdate = true;
  }

  _updateTerrain(dt, freqData, sens) {
    if (!this.terrainGroup.visible) return;
    this._terrainScroll += dt * 10;
    if (this._terrainScroll > 1) {
      this._terrainScroll = 0;
      this._terrainHist.pop();
      const row = new Float32Array(this.terrainCols);
      for (let c = 0; c < this.terrainCols; c++) {
        const bin = 2 + Math.floor(Math.pow(c / (this.terrainCols - 1), 1.7) * freqData.length * 0.5);
        row[c] = (freqData[bin] || 0) / 255;
      }
      this._terrainHist.unshift(row);
    }
    const posAttr = this.terrainGeo.attributes.position;
    const colAttr = this.terrainGeo.attributes.color;
    const theme = this._theme();
    const tmp = new THREE.Color();
    const hScale = 14 * this.params.waveHeight * sens;
    for (let r = 0; r < this.terrainRows; r++) {
      const row = this._terrainHist[r];
      for (let c = 0; c < this.terrainCols; c++) {
        const idx = r * this.terrainCols + c;
        const h = row[c] * hScale + this._beatPulse * 0.5;
        posAttr.array[idx * 3 + 1] = h;
        tmp.copy(theme.c3).lerp(theme.c1, Math.min(1, h / (hScale * 0.7)));
        colAttr.array[idx * 3] = tmp.r; colAttr.array[idx * 3 + 1] = tmp.g; colAttr.array[idx * 3 + 2] = tmp.b;
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  _updateNova(dt, t, freqData, sens) {
    if (!this.novaGroup.visible) return;
    const theme = this._theme();
    const pos = this.novaLines.geometry.attributes.position.array;
    const col = this.novaLines.geometry.attributes.color.array;
    const tmp = new THREE.Color();
    for (let i = 0; i < this.novaSpikes; i++) {
      const d = this._novaDirs[i];
      const bin = 2 + Math.floor(Math.pow(i / (this.novaSpikes - 1), 1.6) * freqData.length * 0.55);
      const amp = (freqData[bin] || 0) / 255;
      const r0 = this.novaR0 * (1 + this._smoothBass * 0.3);
      const len = 0.5 + amp * sens * 11 + this._beatPulse * 1.5;
      pos[i * 6] = d.x * r0; pos[i * 6 + 1] = d.y * r0; pos[i * 6 + 2] = d.z * r0;
      pos[i * 6 + 3] = d.x * (r0 + len); pos[i * 6 + 4] = d.y * (r0 + len); pos[i * 6 + 5] = d.z * (r0 + len);
      tmp.copy(theme.c2);
      col[i * 6] = tmp.r; col[i * 6 + 1] = tmp.g; col[i * 6 + 2] = tmp.b;
      tmp.copy(theme.c1).lerp(theme.c3, amp);
      col[i * 6 + 3] = tmp.r; col[i * 6 + 4] = tmp.g; col[i * 6 + 5] = tmp.b;
    }
    this.novaLines.geometry.attributes.position.needsUpdate = true;
    this.novaLines.geometry.attributes.color.needsUpdate = true;
    const coreScale = 1 + this._smoothBass * sens * 0.5 + this._beatPulse * 0.4;
    this.novaCore.scale.setScalar(coreScale);
    this.novaCore.material.color.copy(theme.c1);
    this.novaGroup.rotation.y += dt * 0.25 * this.params.rotSpeed;
    this.novaGroup.rotation.x = Math.sin(t * 0.3) * 0.25;
  }

  _updateGalaxy(dt, t, sens) {
    if (!this.galaxyPoints.visible) return;
    this._galaxyAngle += dt * (0.15 + this._smoothBass * sens * 0.35) * this.params.rotSpeed;
    const pos = this.galaxyPoints.geometry.attributes.position.array;
    const col = this.galaxyPoints.geometry.attributes.color.array;
    const theme = this._theme();
    const tmp = new THREE.Color();
    const arms = 3;
    for (let i = 0; i < this.galaxyCount; i++) {
      const frac = i / this.galaxyCount;
      const arm = i % arms;
      const seed = this._galaxySeed[i];
      const angle = frac * Math.PI * 5 + (arm / arms) * Math.PI * 2 + this._galaxyAngle;
      const radius = 2 + frac * 26 * (1 + this._smoothBass * sens * 0.15);
      const wobble = Math.sin(seed + t * 2) * (0.3 + this._smoothTreble * sens * 2.2);
      const y = Math.sin(seed * 7 + t) * (0.4 + this._smoothMid * sens * 2.5) * (1 - frac);
      pos[i * 3] = Math.cos(angle) * radius + Math.cos(seed) * wobble;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(angle) * radius + Math.sin(seed) * wobble;
      tmp.copy(theme.c1).lerp(theme.c3, frac);
      const bright = 0.4 + this._smoothEnergy * 0.8 + this._beatPulse * 0.3;
      col[i * 3] = tmp.r * bright; col[i * 3 + 1] = tmp.g * bright; col[i * 3 + 2] = tmp.b * bright;
    }
    this.galaxyPoints.geometry.attributes.position.needsUpdate = true;
    this.galaxyPoints.geometry.attributes.color.needsUpdate = true;
    this.galaxyPoints.material.size = 1.1 * (1 + this._beatPulse * 0.5);
  }

  _updateScope(dt, t, timeData, sens) {
    if (!this.scopeGroup.visible) return;
    const theme = this._theme();
    const tmp = new THREE.Color();
    const draw = (ring, baseR, gain, colA, colB) => {
      const pos = ring.geometry.attributes.position.array;
      const col = ring.geometry.attributes.color.array;
      for (let k = 0; k < this.scopeN; k++) {
        const idx = Math.floor((k / this.scopeN) * timeData.length);
        const sample = (timeData[idx] - 128) / 128;
        const r = baseR + sample * gain + this._beatPulse * 0.8;
        const a = (k / this.scopeN) * Math.PI * 2;
        pos[k * 3] = Math.cos(a) * r;
        pos[k * 3 + 1] = Math.sin(a) * r;
        pos[k * 3 + 2] = sample * gain * 0.5;
        tmp.copy(colA).lerp(colB, Math.min(1, Math.abs(sample) * 2.5));
        col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
      }
      ring.geometry.attributes.position.needsUpdate = true;
      ring.geometry.attributes.color.needsUpdate = true;
    };
    const gain = (2.5 + this._smoothBass * sens * 5) * this.params.waveHeight;
    draw(this.scopeOuter, 9, gain, theme.c1, theme.c3);
    draw(this.scopeInner, 5, gain * 0.7, theme.c2, theme.c1);
    this.scopeGroup.rotation.z += dt * 0.15 * this.params.rotSpeed;
    this.scopeGroup.rotation.y = Math.sin(t * 0.4) * 0.35;
  }

  _updateWaveform(dt, timeData, sens) {
    if (!this.waveformMesh.visible) return;
    this._waveScroll = (this._waveScroll || 0) + dt * 6;
    if (this._waveScroll > 1) {
      this._waveScroll = 0;
      this._waveHistory.pop();
      const row = new Float32Array(this.waveCols);
      for (let c = 0; c < this.waveCols; c++) {
        const idx = Math.floor((c / this.waveCols) * timeData.length);
        row[c] = ((timeData[idx] - 128) / 128) * this.params.waveHeight * sens * 6;
      }
      this._waveHistory.unshift(row);
    }
    const posAttr = this.waveGeo.attributes.position;
    const colAttr = this.waveGeo.attributes.color;
    const theme = this._theme();
    for (let r = 0; r < this.waveRows; r++) {
      const row = this._waveHistory[r];
      for (let c = 0; c < this.waveCols; c++) {
        const idx = r * this.waveCols + c;
        const y = row[c] + this._beatPulse * 0.6;
        posAttr.array[idx * 3 + 1] = y;
        const mixv = Math.min(1, Math.abs(y) / 4);
        const col = theme.c3.clone().lerp(theme.c1, mixv);
        colAttr.array[idx * 3] = col.r; colAttr.array[idx * 3 + 1] = col.g; colAttr.array[idx * 3 + 2] = col.b;
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }
}
