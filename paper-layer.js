/* Paper Shaders layer — WebGL image filters mounted on the logo itself.
   Loaded from the CDN import map, so the page stays build-free and works on
   GitHub Pages. The classic board script reads this through window.paperLayer. */
import {
  ShaderMount,
  imageDitheringFragmentShader,
  paperTextureFragmentShader,
  halftoneCmykFragmentShader,
  liquidMetalFragmentShader,
  toProcessedLiquidMetal,
  getShaderColorFromString,
  ShaderFitOptions,
} from '@paper-design/shaders';

const host = document.getElementById('shaderHost');
const mark = document.getElementById('fvsMark');
const statusEl = document.getElementById('shaderStatus');
const CYCLE_MS = 6000;

const sizing = () => ({
  u_fit: ShaderFitOptions.contain,
  u_scale: 1,
  u_rotation: 0,
  u_originX: 0.5,
  u_originY: 0.5,
  u_offsetX: 0,
  u_offsetY: 0,
  u_worldWidth: 0,
  u_worldHeight: 0,
});

const colour = getShaderColorFromString;
const WHITE = colour('#ffffff');
const CLEAR = [0, 0, 0, 0];

let mount = null;
let mode = 'off';
let scale = 1;
let processed = null;
let busy = false;
let logoImage = null;

function say(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.toggle('is-error', isError);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image could not load.'));
    img.src = src;
  });
}

function logoSource() {
  return mark.getAttribute('src');
}

async function ensureLogo() {
  if (logoImage) return logoImage;
  logoImage = await loadImage(logoSource());
  return logoImage;
}

async function liquidSource() {
  if (processed) return processed;
  const { pngBlob } = await toProcessedLiquidMetal(logoSource());
  processed = await loadImage(URL.createObjectURL(pngBlob));
  return processed;
}

function maskHost() {
  const src = logoSource();
  for (const prop of ['maskImage', 'webkitMaskImage']) host.style[prop] = `url("${src}")`;
  host.style.maskMode = 'alpha';
  host.style.maskSize = 'contain';
  host.style.maskPosition = 'center';
  host.style.maskRepeat = 'no-repeat';
  if ('webkitMaskSize' in host.style) {
    host.style.webkitMaskSize = 'contain';
    host.style.webkitMaskPosition = 'center';
    host.style.webkitMaskRepeat = 'no-repeat';
  }
}

function clearMask() {
  for (const prop of ['maskImage', 'webkitMaskImage']) host.style[prop] = 'none';
}

/* Halftone prints the whole plate: a paper patch with CMYK dots. Masking it to
   the glyph would keep only the fully inked interior, which reads as black. */
function isMasked(next) {
  return next !== 'halftone' && next !== 'matrix';
}

function disposeMount() {
  if (mount) {
    try { mount.dispose(); } catch (error) { console.warn('Shader dispose failed', error); }
    mount = null;
  }
  host.replaceChildren();
}

const MATRIX_2D_FRAG = `#version 300 es
precision mediump float;
in vec2 v_objectUV;
out vec4 fragColor;
uniform sampler2D u_image;
uniform float u_pxSize;
uniform vec2 u_resolution;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  float cell = max(6.0, u_pxSize * 3.0);
  vec2 res = max(u_resolution, vec2(1.0));
  vec2 grid = floor(gl_FragCoord.xy / cell);
  vec2 cellUv = (grid + 0.5) * cell / res;
  vec2 uv = vec2(cellUv.x, 1.0 - cellUv.y);
  float a = texture(u_image, clamp(uv, 0.0, 1.0)).a;
  float nearA = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 q = uv + vec2(float(i), float(j)) * cell / res;
    nearA = max(nearA, texture(u_image, clamp(q, 0.0, 1.0)).a);
  }
  vec2 local = fract(gl_FragCoord.xy / cell);
  float block = step(0.09, local.x) * step(0.09, local.y) * step(local.x, 0.91) * step(local.y, 0.91);
  if (a > 0.35) {
    fragColor = vec4(vec3(block), block);
    return;
  }
  float chance = hash(grid);
  vec2 v = abs(local - 0.5);
  float digit = chance < 0.33
    ? (step(0.18, v.x) * step(v.x, 0.36) * step(v.y, 0.38) + step(0.26, v.y) * step(v.y, 0.38) * step(v.x, 0.36))
    : chance < 0.66
      ? step(v.x, 0.10) * step(v.y, 0.38)
      : step(v.x, 0.11) * step(v.y, 0.11);
  float ga = clamp(digit, 0.0, 1.0) * step(0.12, nearA) * step(0.32, chance);
  fragColor = vec4(vec3(0.78) * ga, ga);
}`;

async function build(next, speed) {
  const image = await ensureLogo();
  const s = sizing();
  switch (next) {
    case 'matrix':
      return {
        shader: MATRIX_2D_FRAG,
        uniforms: {
          ...s, u_image: image, u_imageAspectRatio: 1,
          u_pxSize: 2.2 * scale,
        },
      };
    case 'dither':
      return {
        shader: imageDitheringFragmentShader,
        uniforms: {
          ...s, u_image: image, u_imageAspectRatio: 1,
          u_colorFront: WHITE, u_colorBack: colour('#0a0a0a'), u_colorHighlight: WHITE,
          u_type: 3, u_pxSize: 2.2 * scale, u_colorSteps: 2,
          u_originalColors: false, u_inverted: true,
        },
      };
    case 'paper':
      return {
        shader: paperTextureFragmentShader,
        uniforms: {
          ...s, u_image: image, u_isImage: true, u_imageAspectRatio: 1,
          u_colorBack: CLEAR, u_colorPaper: colour('#cfc9bd'), u_colorShadow: colour('#2a2724'),
          u_blending: 0.62, u_distortion: 0.18, u_clip: true, u_angle: 45, u_seed: 7,
          u_roughness: 0.32, u_roughnessSize: 0.45 * scale, u_roughnessRows: 0.15,
          u_fiber: 0.3, u_fiberSize: 0.4 * scale,
          u_folds: 0.06, u_foldSizeX: 0.42, u_foldSizeY: 0.42, u_foldOffsetX: 0, u_foldOffsetY: 0,
          u_wrinkles: 0.08, u_wrinkleSize: 0.4,
          u_crumples: 0.1, u_crumpleCount: 6, u_drops: 0.14,
        },
      };
    case 'halftone':
      return {
        shader: halftoneCmykFragmentShader,
        uniforms: {
          ...s, u_image: image, u_imageAspectRatio: 1,
          u_colorBack: colour('#f2efe8'),
          u_colorC: colour('#00aeef'), u_colorM: colour('#ec008c'),
          u_colorY: colour('#fff200'), u_colorK: colour('#101010'),
          u_size: 0.62 * scale, u_contrast: 1.15, u_softness: 0.35,
          u_grainSize: 0.4, u_grainMixer: 0.15, u_grainOverlay: 0.1, u_gridNoise: 0.1,
          u_floodC: 0, u_floodM: 0, u_floodY: 0, u_floodK: 0,
          u_gainC: 0, u_gainM: 0, u_gainY: 0, u_gainK: 0,
          u_type: 0,
        },
      };
    case 'liquid':
      return {
        shader: liquidMetalFragmentShader,
        uniforms: {
          ...s, u_image: await liquidSource(), u_isImage: true, u_imageAspectRatio: 1,
          u_colorBack: CLEAR, u_colorTint: WHITE,
          u_repetition: 6 * Math.max(.5, scale), u_shiftRed: 0.35, u_shiftBlue: -0.35,
          u_contour: 0.75, u_softness: 0.34, u_distortion: 0.2, u_angle: 0, u_shape: 0,
        },
      };
    default:
      return null;
  }
}

async function setMode(next) {
  while (busy) await new Promise((resolve) => setTimeout(resolve, 80));
  busy = true;
  mode = next;
  disposeMount();
  /* The old shader hid the plain mark; show it again while a new one builds. */
  mark.style.visibility = '';
  if (next === 'off') {
    /* The live 3D pass keeps its own loop, so it must be stopped here. Without
       this the last dither look stays painted over the 3D preview. */
    stop3d();
    host.dataset.active = 'false';
    host.replaceChildren();
    clearMask();
    mark.style.visibility = '';
    document.getElementById('shaderSize')?.toggleAttribute('disabled', true);
    say('Logo effect off. The mark renders as before.');
    busy = false;
    return mode;
  }
  try {
    if (next === 'liquid' && !processed) say('Preparing liquid metal — this runs once, about 8 seconds.');
    const spec = await build(next, 1);
    if (!spec) throw new Error('Unknown shader.');
    if (isMasked(next)) maskHost(); else clearMask();
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    host.append(canvas);
    mount = new ShaderMount(host, spec.shader, spec.uniforms, { preserveDrawingBuffer: true, premultipliedAlpha: true }, 1, 0, 2, 1_200_000);
    host.dataset.active = 'true';
    mark.style.visibility = 'hidden';
    say(next === 'liquid'
      ? 'Liquid metal runs on the 2D mark only. It bakes into PNG and MP4.'
      : `${labelFor(next)} runs on the logo, 2D and 3D. It bakes into PNG and MP4.`);
    if (three3d) { stop3d(); start3d(); }
  } catch (error) {
    mode = 'off';
    host.dataset.active = 'false';
    mark.style.visibility = '';
    say(`Shader unavailable: ${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    /* After a failed build mode falls back to off, so read it here. */
    document.getElementById('shaderSize')?.toggleAttribute('disabled', mode === 'off');
    busy = false;
  }
  return mode;
}

function labelFor(value) {
  return { matrix: 'Binary matrix', dither: 'Image dithering', paper: 'Paper texture', halftone: 'Halftone CMYK', liquid: 'Liquid metal' }[value] || 'Shader';
}

function setScale(next) {
  scale = Math.max(0.25, Math.min(2, Number(next) || 1));
  if (mount) {
    const sizes = {};
    /* Pattern density, not image zoom, so the mark always fills its frame. */
    if (mode === 'matrix' || mode === 'dither') sizes.u_pxSize = 2.2 * scale;
    if (mode === 'halftone') sizes.u_size = 0.62 * scale;
    if (mode === 'paper') { sizes.u_roughnessSize = 0.45 * scale; sizes.u_fiberSize = 0.4 * scale; }
    if (mode === 'liquid') sizes.u_repetition = 6 * Math.max(.5, scale);
    mount.setUniforms(sizes);
  }
  return scale;
}

function beginCapture() {
  if (mount) mount.setSpeed(0);
}

function phase(t) {
  if (mount) mount.setFrame(Math.min(0.9999, Math.max(0, t)) * CYCLE_MS);
}

function endCapture() {
  if (mount) mount.setSpeed(1);
}

/* ---- live 3D pass -------------------------------------------------------
   ShaderMount only uploads an HTMLImageElement once, so it cannot sample a
   live canvas. The 3D preview therefore runs an equivalent GPU pass of its
   own: one small program that reads #threeCanvas every frame, keeps its alpha,
   and writes the dither, paper or halftone look. */
const VERT = `attribute vec2 a_pos; varying vec2 v_uv;
void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `precision highp float;
varying vec2 v_uv;
uniform sampler2D u_src;
uniform float u_mode;
uniform float u_px;
uniform vec2 u_res;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bayer2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a){ return bayer4(0.5 * a) * 0.25 + bayer2(a); }

void main(){
  if (u_mode > 2.5) {
    float cell = max(6.0, u_px * 2.4);
    vec2 grid = floor(gl_FragCoord.xy / cell);
    vec2 point = (grid + .5) * cell / u_res;
    float a = texture2D(u_src, vec2(point.x, 1.0 - point.y)).a;
    float nearA = 0.0;
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
      vec2 q = point + vec2(float(i), float(j)) * cell / u_res;
      nearA = max(nearA, texture2D(u_src, vec2(q.x, 1.0 - q.y)).a);
    }
    vec2 local = fract(gl_FragCoord.xy / cell);
    float block = step(.09, local.x) * step(.09, local.y) * step(local.x, .91) * step(local.y, .91);
    if (a > .35) { gl_FragColor = vec4(vec3(block), block); return; }
    float chance = hash(grid);
    vec2 v = abs(local - .5);
    float digit = chance < .33 ? (step(.18, v.x) * step(v.x, .36) * step(v.y, .38) + step(.26, v.y) * step(v.y, .38) * step(v.x, .36)) : chance < .66 ? step(v.x, .10) * step(v.y, .38) : step(v.x, .11) * step(v.y, .11);
    float ga = clamp(digit, 0.0, 1.0) * step(.12, nearA) * step(.32, chance);
    gl_FragColor = vec4(vec3(.78) * ga, ga); return;
  }
  vec4 src = texture2D(u_src, vec2(v_uv.x, 1.0 - v_uv.y));
  if (src.a < 0.004) { gl_FragColor = vec4(0.0); return; }
  vec3 col = src.rgb / max(src.a, 0.0001);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec2 px = gl_FragCoord.xy;

  if (u_mode < 0.5) {
    float t = bayer8(px / max(u_px, 1.0));
    float on = step(t, pow(clamp(lum, 0.0, 1.0), 2.2));
    gl_FragColor = vec4(vec3(1.0), src.a * on);
    return;
  }
  if (u_mode < 1.5) {
    float grain = hash(floor(px / max(u_px, 1.0)));
    float fibre = smoothstep(0.62, 0.95, hash(floor(vec2(px.x / max(u_px, 1.0), px.y))));
    float shade = 1.0 - (grain - 0.5) * 0.42 - fibre * 0.10;
    gl_FragColor = vec4(col * shade, src.a);
    return;
  }
  vec2 f = fract(px / max(u_px, 1.0) + 0.5) - 0.5;
  float radius = sqrt(clamp(lum, 0.0, 1.0)) * 0.58;
  float dotOn = step(length(f), radius);
  gl_FragColor = vec4(col * 1.06, src.a * dotOn);
}`;

let gl3 = null, program3 = null, texture3 = null, uniforms3 = null;
let canvas3d = null, loop3d = 0, three3d = false;
/* Set while an export runs, so the pass copies at export resolution. */
let captureSize = null;

function setCaptureSize(width, height) {
  captureSize = width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null;
  return captureSize;
}

function ensure3d() {
  if (canvas3d) return true;
  const frame = document.getElementById('fvsFrame');
  const source = document.getElementById('threeCanvas');
  if (!frame || !source) return false;
  canvas3d = document.createElement('canvas');
  canvas3d.id = 'shader3dCanvas';
  canvas3d.setAttribute('aria-hidden', 'true');
  Object.assign(canvas3d.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    zIndex: '2', pointerEvents: 'none', display: 'none',
    /* Inherit the mark's glow and ink bleed, which may already be applied. */
    filter: source.style.filter || '',
  });
  frame.append(canvas3d);
  gl3 = canvas3d.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
  if (!gl3) { canvas3d = null; return false; }
  const compile = (type, src) => {
    const s = gl3.createShader(type);
    gl3.shaderSource(s, src); gl3.compileShader(s);
    if (!gl3.getShaderParameter(s, gl3.COMPILE_STATUS)) throw new Error(gl3.getShaderInfoLog(s) || 'shader compile failed');
    return s;
  };
  program3 = gl3.createProgram();
  gl3.attachShader(program3, compile(gl3.VERTEX_SHADER, VERT));
  gl3.attachShader(program3, compile(gl3.FRAGMENT_SHADER, FRAG));
  gl3.linkProgram(program3);
  if (!gl3.getProgramParameter(program3, gl3.LINK_STATUS)) throw new Error(gl3.getProgramInfoLog(program3) || 'program link failed');
  gl3.useProgram(program3);
  const buf = gl3.createBuffer();
  gl3.bindBuffer(gl3.ARRAY_BUFFER, buf);
  gl3.bufferData(gl3.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl3.STATIC_DRAW);
  const loc = gl3.getAttribLocation(program3, 'a_pos');
  gl3.enableVertexAttribArray(loc);
  gl3.vertexAttribPointer(loc, 2, gl3.FLOAT, false, 0, 0);
  texture3 = gl3.createTexture();
  gl3.bindTexture(gl3.TEXTURE_2D, texture3);
  gl3.texParameteri(gl3.TEXTURE_2D, gl3.TEXTURE_WRAP_S, gl3.CLAMP_TO_EDGE);
  gl3.texParameteri(gl3.TEXTURE_2D, gl3.TEXTURE_WRAP_T, gl3.CLAMP_TO_EDGE);
  gl3.texParameteri(gl3.TEXTURE_2D, gl3.TEXTURE_MIN_FILTER, gl3.LINEAR);
  gl3.texParameteri(gl3.TEXTURE_2D, gl3.TEXTURE_MAG_FILTER, gl3.LINEAR);
  gl3.pixelStorei(gl3.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  uniforms3 = {
    src: gl3.getUniformLocation(program3, 'u_src'),
    mode: gl3.getUniformLocation(program3, 'u_mode'),
    px: gl3.getUniformLocation(program3, 'u_px'),
    res: gl3.getUniformLocation(program3, 'u_res'),
  };
  return true;
}

const MODE_3D = { dither: 0, paper: 1, halftone: 2, matrix: 3 };

function draw3d() {
  const source = document.getElementById('threeCanvas');
  if (!gl3 || !source || !source.width) return;
  const frame = document.getElementById('fvsFrame');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = captureSize ? captureSize.width : Math.max(1, Math.round(frame.clientWidth * dpr));
  const h = captureSize ? captureSize.height : Math.max(1, Math.round(frame.clientHeight * dpr));
  /* Keep the pattern at the same physical size when the buffer grows. */
  const ratio = captureSize ? w / Math.max(1, frame.clientWidth * dpr) : 1;
  if (canvas3d.width !== w || canvas3d.height !== h) { canvas3d.width = w; canvas3d.height = h; }
  gl3.viewport(0, 0, w, h);
  gl3.bindTexture(gl3.TEXTURE_2D, texture3);
  gl3.texImage2D(gl3.TEXTURE_2D, 0, gl3.RGBA, gl3.RGBA, gl3.UNSIGNED_BYTE, source);
  gl3.useProgram(program3);
  gl3.activeTexture(gl3.TEXTURE0);
  gl3.bindTexture(gl3.TEXTURE_2D, texture3);
  gl3.uniform1i(uniforms3.src, 0);
  gl3.uniform1f(uniforms3.mode, MODE_3D[mode] ?? 0);
  /* Same density curve as the 2D shader, so preview and export agree. */
  gl3.uniform1f(uniforms3.px, Math.max(1, 2.5 * dpr * scale * ratio));
  gl3.uniform2f(uniforms3.res, w, h);
  gl3.drawArrays(gl3.TRIANGLES, 0, 3);
}

function tick3d() {
  loop3d = requestAnimationFrame(tick3d);
  try { draw3d(); } catch (error) { console.warn('3D shader pass stopped', error); stop3d(); }
}

function start3d() {
  if (!three3d || !(mode in MODE_3D)) { stop3d(); return false; }
  if (!ensure3d()) return false;
  const source = document.getElementById('threeCanvas');
  canvas3d.style.display = 'block';
  source.style.visibility = 'hidden';
  if (!loop3d) loop3d = requestAnimationFrame(tick3d);
  return true;
}

function stop3d() {
  if (loop3d) cancelAnimationFrame(loop3d);
  loop3d = 0;
  const source = document.getElementById('threeCanvas');
  if (source) source.style.visibility = '';
  if (canvas3d) canvas3d.style.display = 'none';
}

function set3d(on) {
  three3d = !!on;
  if (three3d) start3d(); else stop3d();
}

window.paperLayer = {
  async refreshLogo() { logoImage = null; processed = null; if (mode !== 'off') await setMode(mode); },
  setMode,
  setScale,
  setCaptureSize,
  set3d,
  beginCapture,
  phase,
  endCapture,
  get mode() { return mode; },
  get scale() { return scale; },
  get active() { return mode !== 'off' && !!mount; },
  get masked() { return isMasked(mode); },
  get canvas() { return host.querySelector('canvas'); },
  get canvas3d() { return mode in MODE_3D && three3d ? canvas3d : null; },
  render3d: draw3d,
  ready: true,
};
window.dispatchEvent(new CustomEvent('paper-layer-ready'));
