import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = id => document.getElementById(id);
const canvas = $('threeCanvas'), status = $('threeStatus'), layer = $('logoLayer');
let renderer, scene, camera, pivot, paths, material, videoTexture, active = false, playing = true, angle = 0;
let previous = performance.now(), lastVideoUrl = '';
/* Export phase lock: while set, animate() stops advancing angle and uTime so a
   recorder can drive both from 0 to an exact integer number of turns. */
let phaseLock = false, playingBeforePhase = true;
function applyBounce() {
  if (risoMode || $('rotationMode')?.value !== 'bounce') return;
  const beats = Math.max(1, Math.round((Number($('upbeatBpm')?.value) || 128) * (Number($('reelLength')?.value) || 2) / 60));
  const pulse = Math.cos(angle * beats);
  pivot.position.y += .22 * pulse;
  pivot.scale.multiplyScalar(1 + .045 * pulse);
}
function renderPhaseFrame() {
  if (!renderer || !pivot) return false;
  if (risoMode) applyRisoStep();
  applyRotation();
  liquidUniforms.uTwist.value = +$('liquidTwist').value / 100;
  const distance = camera.position.z;
  const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  pivot.position.set((parseFloat(layer.style.left) / 100 - .5) * viewHeight * camera.aspect,
    (.5 - parseFloat(layer.style.top) / 100) * viewHeight, 0);
  pivot.scale.setScalar(parseFloat($('scaleSlider').value) / 60);
  applyBounce();
  renderer.render(scene, camera);
  return true;
}
/* One owner for the pivot's rotation, so the live loop and the export phase
   cannot disagree. Riso Flipbook steps upright glyphs, so it stays unrotated. */
function applyRotation() {
  if (!pivot) return;
  const mode = $('rotationMode')?.value || 'yspin';
  if (risoMode || mode === 'still') { pivot.rotation.set(0, 0, 0); return; }
  const beat = angle * Math.max(1, Math.round((Number($('upbeatBpm')?.value) || 128) * (Number($('reelLength')?.value) || 2) / 60));
  if (mode === 'orbital') { pivot.rotation.set(.25*Math.sin(angle), angle, .12*Math.cos(angle)); return; }
  if (mode === 'bounce') { pivot.rotation.set(0,0,0); return; }
  if (mode === 'pendulum') { pivot.rotation.set(0,0,.3*Math.sin(angle)); return; }
  if (mode === 'forward-cw') { pivot.rotation.set(0, 0, -angle); return; }
  if (mode === 'forward-ccw') { pivot.rotation.set(0, 0, angle); return; }
  if (mode === 'iso-ccw') { pivot.rotation.set(0.42, -0.36, angle); return; }
  const vertical = $('arrangement3d').value === 'carousel' && $('carouselAxis').value === 'vertical';
  pivot.rotation.set(vertical ? -angle : 0, vertical ? 0 : -angle, 0);
}
function setPhase(tNorm, loops = 1) {
  if (!renderer || !pivot) return false;
  const t = Math.min(0.999999, Math.max(0, Number(tNorm) || 0));
  const turns = Math.max(0.05, Number(loops) || 1);
  if (!phaseLock) playingBeforePhase = playing;
  phaseLock = true;
  playing = false;
  risoOverride = null;
  angle = t * Math.PI * 2 * turns;
  liquidUniforms.uTime.value = t * Math.PI * 2 * turns;
  applyRisoStep();
  return true;
}
function releasePhase() {
  if (phaseLock) playing = playingBeforePhase;
  phaseLock = false;
  risoOverride = null;
  previous = performance.now();
}
let posterFps = 0;
let spinSeconds = 0;
let risoMode = false;
let risoHolders = [];
let risoJitter = [];
let risoStep = 0;
/* Surface state. Declared before the boot call to rebuild(), because that call
   paints the first surface during module evaluation. */
let stippleTexture, grainTexture, gradientTexture;
let paletteMaterials = [], multiOffset = 0;
let risoSeq = [], risoSeqKey = '', risoOverride = null, risoStepPos = 0, risoOrderSeed = 0;
const RISO_PALETTES = {
  /* Deep ink, not cream: the cream entry vanished on light paper. */
  multi: ['#141414', '#e11d48', '#1d4ed8', '#facc15', '#10b981', '#111111'],
  tiger: ['#f5f2e8', '#c8102e', '#111111', '#a1a1aa'],
  mono: ['#f5f2e8'],
  'pw-cyan-gold': ['#5bc0de', '#e5b84b', '#9fb344', '#141414'],
  'pw-lime-pink': ['#9ee848', '#e879a8', '#f49d56', '#141414'],
  'pw-yellow-coral': ['#f2e55c', '#e88073', '#9b7ec8', '#4a5d23'],
};
function risoPalette() {
  const name = $('flipPalette')?.value || 'multi';
  return RISO_PALETTES[name] || RISO_PALETTES.multi;
}
function setPosterFps(fps) {
  posterFps = Math.max(0, Math.round(Number(fps) || 0));
  return posterFps;
}
function posterClock(seconds) {
  if (!posterFps) return seconds;
  const step = 1 / posterFps;
  return Math.floor(seconds / step) * step;
}
/* During an export the renderer runs at the export pixel size, then returns
   to the preview buffer. The window is always closed by the caller's finally. */
let exportSize = null, restorePreviewSize = () => {};
function beginExportCapture(width, height) {
  if (!renderer || !camera) return false;
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  exportSize = { width: w, height: h };
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  return true;
}
function endExportCapture() {
  if (!exportSize) return false;
  exportSize = null;
  restorePreviewSize();
  return true;
}
const phaseApi = { setPhase, releasePhase, renderPhaseFrame, setPosterFps, beginExportCapture, endExportCapture };
const liquidUniforms = {uTime:{value:0},uTwist:{value:0},uCenter:{value:new THREE.Vector3()},uExtent:{value:1}};

function setStatus(message) { status.textContent = message; }
try {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(512, 512, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
  camera.position.set(0, 0, 9);
  const resizePreview = () => {
    /* Never fight an export for the buffer. */
    if (exportSize) return;
    const frame = $('fvsFrame'), width = frame.clientWidth, height = frame.clientHeight;
    if (!width || !height) return;
    const aspect = width / height, renderWidth = 512, renderHeight = Math.max(1, Math.round(512 / aspect));
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    camera.aspect = aspect; camera.updateProjectionMatrix();
    renderer.setSize(renderWidth, renderHeight, false);
  };
  restorePreviewSize = resizePreview;
  new ResizeObserver(resizePreview).observe($('fvsFrame'));
  resizePreview();
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  // Reflect actual colored softboxes in the environment, not only direct lights.
  for (const [color,x,y,z,w,h] of [[0x66eaff,-4,1,1,2,7],[0xff9b91,4,1,1,2,7],[0xffffff,0,5,0,8,2],[0xcaaaff,0,-3,-4,8,2]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));
    panel.position.set(x,y,z); panel.lookAt(0,0,0); room.add(panel);
  }
  scene.environment = pmrem.fromScene(room).texture;
  room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x41415b, 1.5));
  for (const [color, intensity, x, y, z] of [[0xffffff, 25, -3, 4, 5],[0x64ddff, 15,-4,0,3],[0xff80a5, 15,4,1,3]]) {
    const light = new THREE.PointLight(color, intensity); light.position.set(x,y,z); scene.add(light);
  }
  pivot = new THREE.Group(); scene.add(pivot);
  paths = (await new SVGLoader().loadAsync('./assets/logo-1.svg')).paths;
  rebuild(); setStatus('3D ready · PNG export remains 2D only.');
} catch (error) {
  console.error(error); setStatus(`3D unavailable: ${error.message}. Use 2D SVG.`);
  $('spinBtn').disabled = true;
}

/* ---- surface model ------------------------------------------------------
   Surface fill decides what a letter is made of. Surface texture adds a
   tactile finish on top of any fill. One model for lockup, carousel and
   flipbook, so a colour set or a knit never depends on the arrangement.
   ------------------------------------------------------------------------ */
function surfaceFill() { return $('surfaceFill')?.value || 'chrome'; }
function surfaceTexture() { return $('surfaceTexture')?.value || 'smooth'; }
function hexOr(value, fallback) { return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback; }

/* 512 px knit tile: small paired stitches, so the weave reads as cloth at
   any mark size instead of a grid of blobs. */
function makeStippleTexture() {
  const size = 512, c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = '#7d7d7d'; x.fillRect(0, 0, size, size);
  const cell = 9;
  for (let row = 0; row < size / cell; row++) for (let col = 0; col < size / cell; col++) {
    const cx = col * cell + cell / 2, cy = row * cell + cell / 2;
    const lift = (row + col) % 2 ? 34 : -30;
    const g = x.createRadialGradient(cx, cy, .5, cx, cy, cell * .62);
    g.addColorStop(0, `rgb(${128 + lift},${128 + lift},${128 + lift})`);
    g.addColorStop(.6, `rgb(${128 + Math.round(lift * .3)},${128 + Math.round(lift * .3)},${128 + Math.round(lift * .3)})`);
    g.addColorStop(1, 'rgb(124,124,124)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, cell * .62, 0, Math.PI * 2); x.fill();
    /* A flat slub across the crown keeps the weave from reading as dots. */
    x.fillStyle = 'rgba(255,255,255,.26)';
    x.fillRect(cx - cell * .3, cy - .5, cell * .6, 1);
  }
  for (let i = 0; i < 14000; i++) {
    const v = 90 + (Math.random() * 76 | 0);
    x.fillStyle = `rgba(${v},${v},${v},.5)`;
    x.fillRect(Math.random() * size | 0, Math.random() * size | 0, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 8); t.anisotropy = 8;
  /* No mip chain: a mipmapped micro-pattern averages to flat grey and the
     bump disappears at preview size. */
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

/* Fine 512 px stone/paper micro-grain: high frequency, no visible motif. */
function makeGrainTexture() {
  const size = 512, c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size), d = img.data;
  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < d.length; i += 4) {
    const v = 128 + (rnd() + rnd() - 1) * 52;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6); t.anisotropy = 8;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

/* The gradient runs across the shared planar UVs, so it spans the whole mark. */
function makeGradientTexture(from, to) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 16;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, hexOr(from, '#eceef1'));
  g.addColorStop(1, hexOr(to, '#e11d48'));
  x.fillStyle = g; x.fillRect(0, 0, 256, 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function makeMaterial() {
  const fill = surfaceFill();
  const rough = Math.max(.04, +$('rough3d').value / 100);
  const irid = +$('irid3d').value / 100;
  const c1 = hexOr($('flat3d')?.value, '#eceef1');
  const c2 = hexOr($('flat3d2')?.value, '#e11d48');
  let result;
  if (fill === 'neon') {
    /* The edges carry the look; this shell only occludes what is behind it. */
    return new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: .85, side: THREE.DoubleSide });
  }
  if (fill === 'chrome') {
    /* Iridescence at 0 is polished silver; at 1 it is iridescent chrome. */
    result = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: rough,
      iridescence: irid, iridescenceIOR: 1.3, iridescenceThicknessRange: [210, 900], side: THREE.DoubleSide });
  } else if (fill === 'gel') {
    result = new THREE.MeshPhysicalMaterial({color:0xe8bafa, metalness:.65, roughness:.14, clearcoat:1, emissive:0x35104c, side:THREE.DoubleSide});
  } else if (fill === 'glass') {
    result = new THREE.MeshPhysicalMaterial({color:0xdce8ff, metalness:.08, roughness:.05, transmission:.9, thickness:2, ior:1.5, dispersion:.8, side:THREE.DoubleSide});
  } else if (fill === 'gradient') {
    gradientTexture?.dispose();
    gradientTexture = makeGradientTexture(c1, c2);
    /* Printed fills stay matte; the ink should not read as polished plastic. */
    result = new THREE.MeshPhysicalMaterial({ map: gradientTexture, metalness: 0, roughness: Math.max(.4, rough), side: THREE.DoubleSide });
  } else if (fill === 'video') {
    const opacity = Math.max(0, Math.min(100, Number($('videoOpacity')?.value ?? 100))) / 100;
    result = new THREE.MeshPhysicalMaterial({ metalness: .15, roughness: rough, iridescence: irid,
      iridescenceIOR: 1.3, iridescenceThicknessRange: [210, 900], transparent: true, opacity,
      side: THREE.DoubleSide });
    if (videoTexture) result.map = videoTexture;
    else { result.color.set('#c9ccd2'); setStatus('Choose a local video first. Showing a graphite surface.'); }
  } else {
    /* Solid and multi-colour share one base; multi tints a material per ink.
       Matte by default, because these are printed inks, not metal. */
    result = new THREE.MeshPhysicalMaterial({ color: c1, metalness: 0, roughness: Math.max(.5, rough), side: THREE.DoubleSide });
  }
  const texture = surfaceTexture();
  if (texture === 'stipple') {
    stippleTexture = stippleTexture || makeStippleTexture();
    result.bumpMap = stippleTexture;
    result.bumpScale = .7;
    /* A knit needs a broad, soft highlight, not a specular pin. */
    result.sheen = 1;
    result.sheenRoughness = .45;
    result.sheenColor = new THREE.Color('#ffffff');
  } else if (texture === 'grain') {
    grainTexture = grainTexture || makeGrainTexture();
    result.bumpMap = grainTexture;
    result.bumpScale = .4;
  }
  result.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, liquidUniforms);
    shader.vertexShader = 'uniform float uTime; uniform float uTwist; uniform vec3 uCenter; uniform float uExtent;\n' + shader.vertexShader;
    const twist = 'float liquidY = (position.y - uCenter.y) / max(uExtent, 0.001);\nfloat liquidAngle = uTwist * 0.28 * sin(liquidY * 3.0 + uTime * 1.3);\nfloat lc = cos(liquidAngle), ls = sin(liquidAngle);\nmat2 liquidRotation = mat2(lc, -ls, ls, lc);\n';
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', twist + '#include <beginnormal_vertex>\nobjectNormal.xz = liquidRotation * objectNormal.xz;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz = liquidRotation * (transformed.xz - uCenter.xz) + uCenter.xz;');
  };
  result.customProgramCacheKey = () => `tb-liquid-${fill}-${texture}`;
  return result;
}

let neonLineMaterial = null, neonCoreMaterial = null;
function neonColour() { return hexOr($('flat3d')?.value, '#ff1e3c'); }

function clearNeon(root) {
  root.traverse(object => {
    if (!object.isMesh) return;
    for (const child of [...object.children]) {
      if (!child.isLineSegments) continue;
      object.remove(child);
      child.geometry.dispose();
    }
  });
}

/* Neon reads as a hollow tube: a near-black core hides the back faces and the
   bright unlit rim is what the CSS glow blooms. */
function paintNeon(root) {
  if (!neonLineMaterial) neonLineMaterial = new THREE.LineBasicMaterial({ toneMapped: false });
  neonLineMaterial.color.set(neonColour());
  neonCoreMaterial?.dispose();
  neonCoreMaterial = new THREE.MeshBasicMaterial({
    color: 0x050505, transparent: true, opacity: .85, side: THREE.DoubleSide,
    /* Push the shell back a hair so its own outline wins the depth test. */
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const meshes = [];
  root.traverse(object => { if (object.isMesh) meshes.push(object); });
  for (const mesh of meshes) {
    mesh.material = neonCoreMaterial;
    for (const child of [...mesh.children]) {
      if (!child.isLineSegments) continue;
      mesh.remove(child);
      child.geometry.dispose();
    }
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 18), neonLineMaterial);
    lines.renderOrder = 2;
    mesh.add(lines);
  }
  return meshes.length;
}

/* Give every mesh the fill it should show. Multi-colour rebuilds one material
   per ink and walks the meshes in reading order, so the cycle is stable. */
function paintSurface(root, base) {
  const meshes = [];
  root.traverse(object => { if (object.isMesh) meshes.push(object); });
  const previous = paletteMaterials;
  paletteMaterials = [];
  if (surfaceFill() === 'multi') {
    const palette = risoPalette().filter(Boolean);
    paletteMaterials = palette.map(hex => {
      const tinted = makeMaterial();
      tinted.color.set(hex);
      tinted.needsUpdate = true;
      return tinted;
    });
    meshes.forEach((mesh, i) => {
      mesh.material = paletteMaterials[(i + multiOffset) % paletteMaterials.length];
    });
  } else {
    meshes.forEach(mesh => { mesh.material = base; });
  }
  if (surfaceFill() === 'neon') paintNeon(root);
  else clearNeon(root);
  for (const material of previous) material.dispose();
  return meshes.length;
}

/* Order maps a phase to the displayed sequence: reading, shuffled, or a
   forward-and-back ramp. The seam lands back on the first glyph in each case. */
function risoSequence(n) {
  const order = $('flipOrder')?.value || 'reading';
  const seq = [];
  for (let i = 0; i < n; i++) seq.push(i);
  if (order === 'pingpong') {
    for (let i = n - 2; i >= 1; i--) seq.push(i);
    return seq;
  }
  if (order === 'shuffle') {
    /* Order owns its own seed: shuffling inks must not reorder the glyphs. */
    let seed = (20260101 + risoOrderSeed * 7919) >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = seq.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const swap = seq[i]; seq[i] = seq[j]; seq[j] = swap;
    }
  }
  return seq;
}
function currentRisoSequence() {
  const n = risoHolders.length;
  const key = `${n}|${$('flipOrder')?.value || 'reading'}|${risoOrderSeed}`;
  if (key !== risoSeqKey) { risoSeq = risoSequence(n); risoSeqKey = key; }
  return risoSeq;
}
function syncFrameControl(pos, total) {
  const input = $('flipFrame'), out = $('flipFrameVal');
  if (input) {
    if (input.max !== String(total)) input.max = String(total);
    if (document.activeElement !== input && input.value !== String(pos + 1)) input.value = String(pos + 1);
  }
  const label = `${pos + 1} / ${total}`;
  if (out && out.textContent !== label) out.textContent = label;
}

/* Map the phase to a glyph and apply the registration jitter. */
function applyRisoStep() {
  if (!risoMode || !risoHolders.length) return;
  const seq = currentRisoSequence(), total = seq.length;
  const turn = Math.PI * 2;
  let pos;
  if (risoOverride !== null) {
    pos = Math.max(0, Math.min(total - 1, Math.round(risoOverride)));
  } else {
    const t = (((angle % turn) + turn) % turn) / turn;
    pos = Math.min(total - 1, Math.floor(t * total));
  }
  const step = seq[pos];
  risoStep = step; risoStepPos = pos;
  for (let i = 0; i < risoHolders.length; i++) risoHolders[i].visible = i === step;
  const jitter = risoJitter[step], holder = risoHolders[step];
  if (jitter && holder) {
    /* 0 % dead-locked, 100 % loose analog zine */
    const amp = (Math.max(0, Math.min(100, Number($('flipJitter')?.value ?? 35))) / 100) * 0.09;
    holder.position.set(jitter.x * amp, jitter.y * amp, 0);
    holder.rotation.z = jitter.r * amp;
  }
  syncFrameControl(pos, total);
}

/* Hold one glyph while paused, so a step can be inspected at full size. */
function setRisoFrame(pos) {
  if (!risoMode || !risoHolders.length) return false;
  risoOverride = Math.max(0, Math.round(Number(pos) || 0));
  playing = false;
  const button = $('pause3d');
  if (button) button.textContent = 'Play';
  renderPhaseFrame();
  return true;
}
function setRisoOrder() {
  /* A fresh shuffle each time Order is touched. */
  risoOrderSeed++;
  risoSeqKey = '';
  risoOverride = null;
  if (risoMode) { applyRisoStep(); renderPhaseFrame(); }
  return true;
}
/* Rotate the ink cycle without touching the palette order. */
function shuffleColors(seed) {
  multiOffset = Number.isFinite(Number(seed)) ? Math.max(0, Math.round(Number(seed))) : Math.floor(Math.random() * 997) + 1;
  if (pivot) paintSurface(pivot, material);
  if (risoMode) applyRisoStep();
  return multiOffset;
}

function rebuild() {
  if (!paths || !pivot) return;
  for (const child of [...pivot.children]) {
    pivot.remove(child);
    child.traverse(o => {
      if (o.isMesh || o.isLineSegments) o.geometry?.dispose();
    });
  }
  material?.dispose(); material = makeMaterial();
  const group = new THREE.Group();
  const mode = $('arrangement3d').value;
  const carousel = mode === 'carousel';
  const riso = mode === 'riso';
  risoMode = riso;
  const depth = Math.max(1, +$('depthSlider').value) * (carousel ? 1.05 : 1.8);
  const bevel = +$('bevel3d').value * (carousel ? .3 : 1);
  for (const path of paths) for (const shape of SVGLoader.createShapes(path)) {
    const geom = new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled:bevel > 0, bevelThickness:bevel, bevelSize:bevel, bevelSegments:3, curveSegments:10, steps:1});
    const mesh = new THREE.Mesh(geom, material);
    mesh.onBeforeRender = () => {
      const box = mesh.geometry.boundingBox;
      if (box) { box.getCenter(liquidUniforms.uCenter.value); liquidUniforms.uExtent.value = Math.max(box.max.y-box.min.y,1); }
    };
    group.add(mesh);
  }
  // One shared planar UV space across every letter, including bevel vertices.
  const bounds = new THREE.Box3();
  for (const mesh of group.children) { mesh.geometry.computeBoundingBox(); bounds.union(mesh.geometry.boundingBox); }
  const width = bounds.max.x - bounds.min.x || 1, height = bounds.max.y - bounds.min.y || 1;
  for (const mesh of group.children) {
    const pos = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i)-bounds.min.x)/width, 1-(pos.getY(i)-bounds.min.y)/height);
    uv.needsUpdate = true;
  }
  if (carousel || riso) {
    const radius = +$('carouselRadius').value, letterScale = +$('letterScale').value;
    const origin = bounds.getCenter(new THREE.Vector3());
    const logoSize = bounds.getSize(new THREE.Vector3());
    const minArea = logoSize.x * logoSize.y * .00025;
    const candidates = [...group.children];
    const area = mesh => { const s = mesh.geometry.boundingBox.getSize(new THREE.Vector3()); return s.x*s.y; };
    const areas = candidates.map(area).sort((a,b) => a-b);
    const median = areas[Math.floor(areas.length/2)] || 0;
    const main = candidates.filter(mesh => area(mesh) >= Math.max(minArea, median*.3));
    const details = candidates.filter(mesh => !main.includes(mesh));
    const attachments = new Map(main.map(mesh => [mesh, []]));
    for (const detail of details) {
      const box = detail.geometry.boundingBox, c = box.getCenter(new THREE.Vector3());
      let nearest, best = Infinity;
      for (const mesh of main) {
        const b = mesh.geometry.boundingBox, s = b.getSize(new THREE.Vector3());
        const dx = Math.max(b.min.x-c.x, 0, c.x-b.max.x), dy = Math.max(b.min.y-c.y, 0, c.y-b.max.y);
        const distance = Math.hypot(dx,dy);
        if (distance < best && distance < Math.max(s.x,s.y)*.65) { best=distance; nearest=mesh; }
      }
      if (nearest) attachments.get(nearest).push(detail);
      else detail.geometry.dispose();
    }
    const pieces = main;
    /* The flipbook shows one letter per step, so it keeps the letters whole
       and drops the small attached flourishes instead of merging them in. */
    if (!riso) for (const mesh of pieces) {
      const children = attachments.get(mesh);
      if (!children.length) continue;
      const geometries = [mesh, ...children].map(item => item.geometry);
      const combined = mergeGeometries(geometries, true);
      if (combined) {
        geometries.forEach(geometry => geometry.dispose());
        combined.clearGroups(); combined.computeBoundingBox(); mesh.geometry = combined;
      }
    }
    // Reading order: top arc L->R (T-I-G-E-R-S), bottom arc L->R (B-L-O-O-D), then center Texas mark.
    const topArc = [], botArc = [], centerMarks = [];
    pieces.forEach(mesh => {
      const c = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
      const dx = c.x - origin.x, dy = c.y - origin.y;
      const outer = Math.hypot(dx / logoSize.x, dy / logoSize.y) > .18;
      if (!outer) centerMarks.push(mesh);
      else if (dy < 0) topArc.push(mesh);
      else botArc.push(mesh);
    });
    const byX = (a, b) => a.geometry.boundingBox.getCenter(new THREE.Vector3()).x - b.geometry.boundingBox.getCenter(new THREE.Vector3()).x;
    topArc.sort(byX);
    botArc.sort(byX);
    const ordered = [...topArc, ...botArc, ...centerMarks];
    if (riso) {
      /* Riso Flipbook: one huge glyph per step, pivoting on the shared pivot. */
      group.clear();
      risoHolders = [];
      risoJitter = [];
      const jitter = (n => () => ((n = (n * 1664525 + 1013904223) >>> 0) / 4294967296))(20260101);
      ordered.forEach((mesh, index) => {
        const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
        mesh.geometry.translate(-center.x, -center.y, -center.z);
        mesh.geometry.computeBoundingBox();
        const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
        const factor = Math.min(4.2 / Math.max(size.y, 1), 5.4 / Math.max(size.x, 1));
        mesh.scale.set(factor, -factor, factor);
        const holder = new THREE.Group();
        holder.add(mesh);
        holder.visible = index === 0;
        risoJitter.push({
          x: jitter() * 2 - 1,
          y: jitter() * 2 - 1,
          r: jitter() * 2 - 1,
        });
        risoHolders.push(holder);
        group.add(holder);
      });
      pivot.add(group);
      paintSurface(pivot, material);
      risoSeqKey = '';
      risoOverride = null;
      applyRisoStep();
      window.__tb3d = withSurfaceView({get shapes(){return risoHolders.length},get angle(){return angle},get active(){return active},get mode(){return 'riso'},get step(){return risoStep},get stepPos(){return risoStepPos},...phaseApi, ...surfaceApi()});
      return;
    }
    group.clear();
    ordered.forEach((mesh, index) => {
      const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
      const dx = center.x-origin.x, dy = center.y-origin.y;
      const outer = Math.hypot(dx / logoSize.x, dy / logoSize.y) > .18;
      mesh.geometry.translate(-center.x,-center.y,-center.z);
      // SVG y points down: upright top-arc and bottom-arc glyphs separately.
      if (outer) {
        if (dy < 0) mesh.geometry.rotateZ(-Math.atan2(dx, -dy));
        else mesh.geometry.rotateZ(Math.atan2(dx, dy));
      }
      mesh.geometry.computeBoundingBox();
      const holder = new THREE.Group(), a = index * Math.PI * 2 / ordered.length;
      const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
      const vertical = $('carouselAxis').value === 'vertical';
      const slot = 2 * radius * Math.sin(Math.PI / ordered.length) * .85;
      const factor = Math.min(letterScale / Math.max(size.y,1), letterScale * 1.5 / Math.max(size.x,1), slot / Math.max(vertical ? size.y : size.x,1));
      mesh.scale.set(factor,-factor,factor);
      if ($('carouselAxis').value === 'vertical') {
        holder.position.set(0,-Math.sin(a)*radius,Math.cos(a)*radius); holder.rotation.x = a;
      } else {
        holder.position.set(Math.sin(a)*radius,0,Math.cos(a)*radius); holder.rotation.y = a;
      }
      holder.add(mesh); group.add(holder);
    });
    pivot.add(group);
    paintSurface(pivot, material);
    window.__tb3d = withSurfaceView({get shapes(){return pieces.length},get angle(){return angle},get active(){return active},get mode(){return 'carousel'},...phaseApi, ...surfaceApi()});
    return;
  }
  group.scale.y = -1;
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  group.position.sub(center);
  const scale = 4.1 / Math.max(size.x,size.y); group.scale.multiplyScalar(scale); group.position.multiplyScalar(scale);
  pivot.add(group);
  paintSurface(pivot, material);
  window.__tb3d = withSurfaceView({ get shapes(){return group.children.length}, get holes(){return paths.reduce((n,p)=>n+SVGLoader.createShapes(p).reduce((sum,s)=>sum+s.holes.length,0),0)}, get angle(){return angle}, get active(){return active}, ...phaseApi, ...surfaceApi() });
}

/* A fill or texture change never needs new geometry, only new materials. */
function refreshMaterial() {
  if (!pivot) return;
  const old = material;
  material = makeMaterial();
  paintSurface(pivot, material);
  old?.dispose();
}
/* Hoisted: rebuild() runs during module evaluation, before this line. */
let logoLoadSequence = 0;
async function setLogo(src) {
  const sequence = ++logoLoadSequence;
  const loaded = await new SVGLoader().loadAsync(src);
  if (sequence !== logoLoadSequence) return false;
  if (!loaded.paths.length) throw new Error('SVG contains no supported paths.');
  paths = loaded.paths;
  rebuild();
  return true;
}
function surfaceApi() {
  return { setLogo, setRisoFrame, setRisoOrder, shuffleColors, refreshMaterial, refreshRiso: applyRisoStep, applyRotation };
}
/* Object spread copies a getter's value once, so the live surface view is
   defined on the finished object instead of inside the spread. */
function withSurfaceView(api) {
  Object.defineProperty(api, 'renderSize', {
    enumerable: true,
    get: () => [canvas.width, canvas.height],
  });
  Object.defineProperty(api, 'capturing', {
    enumerable: true,
    get: () => !!exportSize,
  });
  Object.defineProperty(api, 'surface', {
    enumerable: true,
    get: () => ({
      fill: surfaceFill(),
      texture: surfaceTexture(),
      palette: $('flipPalette')?.value || 'multi',
      offset: multiOffset,
      inks: paletteMaterials.map(m => '#' + m.color.getHexString()),
      bump: !!material?.bumpMap,
      sheen: material?.sheen || 0,
      opacity: material?.opacity ?? 1,
    }),
  });
  return api;
}

window.addEventListener('preview3d', e => {
  active = !!e.detail && !!renderer;
  canvas.style.display = active ? 'block' : 'none';
  $('fvsMark').style.display = active ? 'none' : 'block';
  $('logoCanvas').style.display = 'none';
  (active ? $('fvsFrame') : layer).appendChild($('printCanvas'));
  for (const slice of layer.querySelectorAll('.vol-slice')) slice.remove();
  previous = performance.now();
  spinSeconds = 0;
});
window.addEventListener('logo-video', () => {
  videoTexture?.dispose(); videoTexture = new THREE.VideoTexture($('srcLogoVid'));
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  videoTexture.needsUpdate = true;
  $('srcLogoVid').play().catch(() => setStatus('Video could not play. Choose a supported local video.'));
  const fill = $('surfaceFill');
  if (fill) { fill.value = 'video'; fill.dispatchEvent(new Event('change', { bubbles: true })); }
  if (!active) $('spinBtn').click();
  requestAnimationFrame(()=>{ canvas.style.display='block'; $('fvsMark').style.display='none'; $('logoCanvas').style.display='none'; refreshMaterial(); });
});
for (const id of ['flat3d','flat3d2','rough3d','irid3d']) $(id).addEventListener('input',refreshMaterial);
for (const id of ['depthSlider','bevel3d']) $(id).addEventListener('input',rebuild);
for (const id of ['arrangement3d','carouselRadius','letterScale','carouselAxis','flipPalette']) $(id).addEventListener('change',rebuild);
$('pause3d').addEventListener('click', e=>{
  playing=!playing;
  /* Resuming playback releases a held flipbook frame. */
  if (playing) risoOverride = null;
  e.target.textContent=playing?'Pause':'Play';
  previous=performance.now();
});
$('reset3d').addEventListener('click',()=>{angle=0; risoOverride=null; if(pivot)pivot.rotation.set(0,0,0);});
for (const button of document.querySelectorAll('[data-preview-bg]')) button.addEventListener('click',()=>{
  const value=button.dataset.previewBg;
  $('bgImg').style.display='none'; $('bgVid').style.display='none';
  if(value==='transparent') $('fvsFrame').style.background='repeating-conic-gradient(#303035 0% 25%,#1a1a1d 0% 50%) 0 / 20px 20px';
  else { $('bgColor1').value=value==='red'?'#c8102e':'#000000'; $('fvsFrame').style.background=$('bgColor1').value; }
});
function animate(now) {
  const dt=Math.min((now-previous)/1000,.1); previous=now;
  if(active && renderer && pivot) {
    if(!phaseLock) {
      const rate = $('arrangement3d').value === 'carousel' ? 0.375 : 0.5;
      if(playing) spinSeconds += dt * rate;
      const clock = posterClock(spinSeconds);
      angle = (clock * Math.PI * 2 / Math.max(0.1, +$('speed3d').value)) % (Math.PI * 2);
      liquidUniforms.uTime.value = posterClock((now / 1000) * 0.5);
    }
    if (risoMode) applyRisoStep();
    applyRotation();
    liquidUniforms.uTwist.value = +$('liquidTwist').value / 100;
    const frame = $('fvsFrame'), distance = camera.position.z;
    const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    pivot.position.set((parseFloat(layer.style.left)/100-.5)*viewHeight*camera.aspect, (.5-parseFloat(layer.style.top)/100)*viewHeight, 0);
    pivot.scale.setScalar(parseFloat($('scaleSlider').value)/60);
    applyBounce();
    renderer.render(scene,camera);
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
