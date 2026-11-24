/**
 * Analog post-process for Tiger's Blood FVS Studio.
 *
 * One ordered WebGL2 chain over the composed frame: downsample → NTSC/VHS →
 * TV glitch → bloom → CRT. The parameter table below is the single owner of
 * the defaults, the UI ranges and the four presets; the board script only
 * forwards values and renders.
 */

export const POST_CONTROLS = [
  { key: 'chroma', label: 'Chroma bleed', min: 0, max: 1, step: 0.01, default: 0.35 },
  { key: 'noise', label: 'Tape noise', min: 0, max: 1, step: 0.01, default: 0.12 },
  { key: 'tracking', label: 'Tracking', min: 0, max: 1, step: 0.01, default: 0.1 },
  { key: 'wear', label: 'Tape wear', min: 0, max: 1, step: 0.01, default: 0.08 },
  { key: 'glitch', label: 'TV glitch', min: 0, max: 1, step: 0.01, default: 0 },
  { key: 'scan', label: 'Scanlines', min: 0, max: 1, step: 0.01, default: 0.34 },
  { key: 'mask', label: 'Phosphor mask', min: 0, max: 1, step: 0.01, default: 0.18 },
  { key: 'bloom', label: 'Bloom', min: 0, max: 1, step: 0.01, default: 0.35 },
  { key: 'curve', label: 'Curvature', min: 0, max: 1, step: 0.01, default: 0.16 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, default: 0.18 },
];

export const POST_DEFAULTS = Object.fromEntries(POST_CONTROLS.map((control) => [control.key, control.default]));
export const POST_SAMPLE_WIDTH = 320;

const preset = (overrides) => ({ ...POST_DEFAULTS, ...overrides });

export const POST_PRESETS = {
  clean: {
    label: 'Clean CRT',
    params: preset({ chroma: 0.2, noise: 0.06, tracking: 0.03, wear: 0.03, glitch: 0, scan: 0.34, mask: 0.18, bloom: 0.35, curve: 0.14, vignette: 0.16 }),
  },
  used: {
    label: 'Used VHS',
    params: preset({ chroma: 0.45, noise: 0.18, tracking: 0.18, wear: 0.14, glitch: 0.05, scan: 0.32, mask: 0.2, bloom: 0.42, curve: 0.2, vignette: 0.2 }),
  },
  moldy: {
    label: 'Moldy Rental Tape',
    params: preset({ chroma: 0.62, noise: 0.3, tracking: 0.42, wear: 0.4, glitch: 0.14, scan: 0.28, mask: 0.2, bloom: 0.5, curve: 0.24, vignette: 0.24 }),
  },
  glitchy: {
    label: 'Glitchy Broadcast',
    params: preset({ chroma: 0.4, noise: 0.24, tracking: 0.2, wear: 0.15, glitch: 0.55, scan: 0.3, mask: 0.18, bloom: 0.46, curve: 0.18, vignette: 0.2 }),
  },
};

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const NOISE = `
float hash12(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 rgb2yiq(vec3 c) {
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312)));
}
vec3 yiq2rgb(vec3 c) {
  return vec3(dot(c, vec3(1.0, 0.956, 0.621)), dot(c, vec3(1.0, -0.272, -0.647)), dot(c, vec3(1.0, -1.106, 1.703)));
}
`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
void main() { outColor = vec4(texture(uTex, vUv).rgb, 1.0); }`;

const NTSC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime, uChroma, uNoise, uTracking, uHead, uJitter, uWear, uSharp;
${NOISE}
vec3 tap(vec2 uv) { return rgb2yiq(texture(uTex, clamp(uv, 0.0, 1.0)).rgb); }
void main() {
  vec2 uv = vUv;
  float line = floor(uv.y * uRes.y);
  float texel = 1.0 / uRes.x;
  float j = hash12(vec2(line, floor(uTime * 24.0)));
  uv.x += (j - 0.5) * uJitter * 0.010;
  uv.x += sin(uv.y * 97.0 + uTime * 2.9) * uJitter * 0.0018;
  float band = pow(0.5 + 0.5 * sin(uv.y * 9.42 - uTime * 1.35), 8.0) * uTracking;
  uv.x += band * 0.03 * (hash12(vec2(line, floor(uTime * 18.0))) - 0.5);
  float head = (1.0 - smoothstep(0.0, 0.05, uv.y)) * uHead;
  uv.x += head * (0.028 + 0.02 * hash12(vec2(line, floor(uTime * 24.0))));
  vec3 centre = tap(uv), left = tap(uv - vec2(texel, 0.0)), right = tap(uv + vec2(texel, 0.0));
  float luma = centre.x + (centre.x - (left.x + right.x) * 0.5) * uSharp * 0.9;
  vec2 chroma = mix(left.yz * 0.25 + centre.yz * 0.5 + right.yz * 0.25, tap(uv + vec2(texel * 1.25, 0.0)).yz, 0.22);
  chroma = mix(centre.yz, chroma, clamp(uChroma, 0.0, 1.0));
  float fine = hash13(vec3(floor(uv * uRes), floor(uTime * 30.0)));
  float coarse = hash12(vec2(line, floor(uTime * 20.0)));
  luma += (fine - 0.5) * uNoise * 0.26 + (coarse - 0.5) * uNoise * 0.2;
  luma += band * (fine - 0.5) * 0.3 + head * 0.06;
  float dropout = step(0.9994, hash12(vec2(line, floor(uTime * 15.0))));
  luma += dropout * uWear * 0.3;
  vec3 rgb = yiq2rgb(vec3(luma, chroma));
  rgb = mix(rgb, vec3(dot(rgb, vec3(0.299, 0.587, 0.114))), uWear * 0.18);
  outColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;

const GLITCH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime, uRoll, uTearing, uSync, uSnow;
${NOISE}
void main() {
  vec2 uv = vUv;
  uv.y = fract(uv.y + uRoll * 0.09 * (0.5 + 0.5 * sin(uTime * 0.7)) + floor(uTime * 1.6) * uRoll * 0.02);
  float row = floor(uv.y * uRes.y);
  float band = step(0.72, hash12(vec2(floor(uTime * 8.0), floor(uv.y * 14.0))));
  uv.x += band * uTearing * 0.09 * (hash12(vec2(row, floor(uTime * 12.0))) - 0.5);
  uv.x += sin(uv.y * 9.0 + uTime * 2.1) * uSync * 0.012;
  vec3 color = texture(uTex, clamp(uv, 0.0, 1.0)).rgb;
  float barPos = fract(uv.y - uTime * 0.18);
  float blank = smoothstep(0.022, 0.0, abs(barPos - 0.04)) * step(0.01, uRoll);
  color = mix(color, vec3(0.02), blank * 0.8);
  float snow = hash12(uv * uRes + vec2(uTime * 91.0, uTime * 53.0));
  color = mix(color, vec3(snow), uSnow * smoothstep(0.55, 1.0, snow));
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

const BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uThreshold;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float knee = clamp((luma - uThreshold) / max(0.0001, 1.0 - uThreshold), 0.0, 1.0);
  outColor = vec4(c * knee * knee, 1.0);
}`;

const BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  vec3 sum = texture(uTex, vUv).rgb * 0.227027;
  sum += (texture(uTex, vUv + uDir).rgb + texture(uTex, vUv - uDir).rgb) * 0.1945946;
  sum += (texture(uTex, vUv + uDir * 2.0).rgb + texture(uTex, vUv - uDir * 2.0).rgb) * 0.1216216;
  sum += (texture(uTex, vUv + uDir * 3.0).rgb + texture(uTex, vUv - uDir * 3.0).rgb) * 0.054054;
  sum += (texture(uTex, vUv + uDir * 4.0).rgb + texture(uTex, vUv - uDir * 4.0).rgb) * 0.016216;
  outColor = vec4(sum, 1.0);
}`;

const CRT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uProc;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform float uScan, uMask, uBloomMix, uCurve, uVig;
uniform float uPitchX, uPitchY;

vec2 barrel(vec2 uv) {
  vec2 p = (uv * 2.0 - 1.0) / (1.0 + uCurve * 0.22);
  p *= 1.0 + uCurve * 0.11 * dot(p, p);
  return p * 0.5 + 0.5;
}
vec3 grille(float x) {
  float px = mod(x, 3.0);
  vec3 m = vec3(
    smoothstep(1.7, 0.35, abs(px - 0.5)),
    smoothstep(1.7, 0.35, abs(px - 1.5)),
    smoothstep(1.7, 0.35, abs(px - 2.5)));
  return m / max(1e-3, m.r + m.g + m.b);
}

void main() {
  vec2 uv = uCurve > 0.001 ? barrel(vUv) : vUv;
  vec3 color = vec3(0.0);
  if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
    color = texture(uProc, uv).rgb;
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float phase = 0.5 + 0.5 * cos(3.14159265 * floor(gl_FragCoord.y / uPitchY));
    float gap = uScan * mix(0.6, 0.28, clamp(luma, 0.0, 1.0));
    color *= (1.0 - gap * pow(1.0 - phase, 2.0)) / max(0.55, 1.0 - 0.5 * gap);
    float slot = 0.94 + 0.06 * step(0.5, fract(gl_FragCoord.y / uPitchY * 0.5));
    color = mix(color, color * grille(gl_FragCoord.x / uPitchX) * slot, uMask);
    color /= max(0.15, 1.0 - uMask * 0.643);
    color += texture(uBloom, uv).rgb * uBloomMix;
    color *= 1.06;
    float r = length(vUv - 0.5) * 1.414;
    color *= mix(1.0, smoothstep(1.05, 0.35, r), uVig);
  }
  color /= max(1.0, max(color.r, max(color.g, color.b)));
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

function program(gl, fragment) {
  const compile = (type, source) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
    }
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) || 'program link failed');
  }
  return { prog, uniforms: new Map() };
}

function target(gl, width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, width, height };
}

function resizeTarget(gl, t, width, height) {
  if (t.width === width && t.height === height) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
  const fresh = target(gl, width, height);
  t.tex = fresh.tex;
  t.fbo = fresh.fbo;
  t.width = width;
  t.height = height;
}

export class TbPost {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('This browser does not provide WebGL2 for the analog post.');
    this.gl = gl;
    this.canvas = canvas;
    this.progs = {
      blit: program(gl, BLIT),
      ntsc: program(gl, NTSC),
      glitch: program(gl, GLITCH),
      bright: program(gl, BRIGHT),
      blur: program(gl, BLUR),
      crt: program(gl, CRT),
    };
    this.source = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.low = target(gl, 320, 180);
    this.mid = target(gl, 320, 180);
    this.swap = target(gl, 320, 180);
    this.bloomA = target(gl, 64, 64);
    this.bloomB = target(gl, 64, 64);
    this.vao = gl.createVertexArray();
  }

  uniform(p, name) {
    if (!p.uniforms.has(name)) p.uniforms.set(name, this.gl.getUniformLocation(p.prog, name));
    return p.uniforms.get(name);
  }

  set1(p, name, value) {
    const loc = this.uniform(p, name);
    if (loc) this.gl.uniform1f(loc, value);
  }

  set2(p, name, x, y) {
    const loc = this.uniform(p, name);
    if (loc) this.gl.uniform2f(loc, x, y);
  }

  bind(p, name, unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const loc = this.uniform(p, name);
    if (loc) gl.uniform1i(loc, unit);
  }

  draw(p) {
    const gl = this.gl;
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /**
   * Render one post-processed frame. `source` is the composed 2D frame;
   * width/height are the output backing pixels.
   */
  render(source, width, height, time, params) {
    const gl = this.gl;
    const canvas = this.canvas;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const lowW = Math.max(64, Math.round(params.sampleWidth || POST_SAMPLE_WIDTH));
    const lowH = Math.max(2, Math.round((lowW * height) / width));

    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    for (const t of [this.low, this.mid, this.swap]) resizeTarget(gl, t, lowW, lowH);
    const bloomW = Math.max(8, Math.round(width / 2));
    const bloomH = Math.max(8, Math.round(height / 2));
    resizeTarget(gl, this.bloomA, bloomW, bloomH);
    resizeTarget(gl, this.bloomB, bloomW, bloomH);

    gl.disable(gl.BLEND);
    gl.viewport(0, 0, lowW, lowH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.low.fbo);
    gl.useProgram(this.progs.blit.prog);
    this.bind(this.progs.blit, 'uTex', 0, this.source);
    this.draw(this.progs.blit);

    gl.useProgram(this.progs.ntsc.prog);
    gl.viewport(0, 0, lowW, lowH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mid.fbo);
    this.bind(this.progs.ntsc, 'uTex', 0, this.low.tex);
    this.set2(this.progs.ntsc, 'uRes', lowW, lowH);
    this.set1(this.progs.ntsc, 'uTime', time);
    this.set1(this.progs.ntsc, 'uChroma', params.chroma);
    this.set1(this.progs.ntsc, 'uNoise', params.noise);
    this.set1(this.progs.ntsc, 'uTracking', params.tracking);
    this.set1(this.progs.ntsc, 'uHead', Math.min(1, params.tracking * 1.2));
    this.set1(this.progs.ntsc, 'uJitter', Math.min(1, params.tracking * 0.9 + params.noise * 0.4));
    this.set1(this.progs.ntsc, 'uWear', params.wear);
    this.set1(this.progs.ntsc, 'uSharp', 0.45);
    this.draw(this.progs.ntsc);

    gl.useProgram(this.progs.glitch.prog);
    gl.viewport(0, 0, lowW, lowH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.swap.fbo);
    this.bind(this.progs.glitch, 'uTex', 0, this.mid.tex);
    this.set2(this.progs.glitch, 'uRes', lowW, lowH);
    this.set1(this.progs.glitch, 'uTime', time);
    this.set1(this.progs.glitch, 'uRoll', params.glitch * 0.5);
    this.set1(this.progs.glitch, 'uTearing', params.glitch * 0.65);
    this.set1(this.progs.glitch, 'uSync', params.glitch * 0.5);
    this.set1(this.progs.glitch, 'uSnow', params.glitch * 0.35);
    this.draw(this.progs.glitch);

    gl.useProgram(this.progs.bright.prog);
    gl.viewport(0, 0, bloomW, bloomH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
    this.bind(this.progs.bright, 'uTex', 0, this.swap.tex);
    this.set1(this.progs.bright, 'uThreshold', 0.6);
    this.draw(this.progs.bright);

    gl.useProgram(this.progs.blur.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB.fbo);
    this.bind(this.progs.blur, 'uTex', 0, this.bloomA.tex);
    this.set2(this.progs.blur, 'uDir', 1.8 / bloomW, 0);
    this.draw(this.progs.blur);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
    this.bind(this.progs.blur, 'uTex', 0, this.bloomB.tex);
    this.set2(this.progs.blur, 'uDir', 0, 1.8 / bloomH);
    this.draw(this.progs.blur);

    gl.useProgram(this.progs.crt.prog);
    gl.viewport(0, 0, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.bind(this.progs.crt, 'uProc', 0, this.swap.tex);
    this.bind(this.progs.crt, 'uBloom', 1, this.bloomA.tex);
    this.set2(this.progs.crt, 'uRes', width, height);
    this.set1(this.progs.crt, 'uScan', params.scan);
    this.set1(this.progs.crt, 'uMask', params.mask);
    this.set1(this.progs.crt, 'uBloomMix', params.bloom);
    this.set1(this.progs.crt, 'uCurve', params.curve);
    this.set1(this.progs.crt, 'uVig', params.vignette);
    /* One line per two pixels at the 280x350 @2x reference, scaled to the
       current output so the preview and a 4x PNG keep the same pitch. */
    this.set1(this.progs.crt, 'uPitchX', Math.min(8, Math.max(1, width / 560)));
    this.set1(this.progs.crt, 'uPitchY', Math.min(8, Math.max(1, height / 700)));
    this.draw(this.progs.crt);
  }

  dispose() {
    const gl = this.gl;
    for (const t of [this.low, this.mid, this.swap, this.bloomA, this.bloomB]) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    for (const p of Object.values(this.progs)) gl.deleteProgram(p.prog);
    gl.deleteTexture(this.source);
    gl.deleteVertexArray(this.vao);
  }
}

if (typeof window !== 'undefined') {
  window.TbPost = { TbPost, POST_CONTROLS, POST_DEFAULTS, POST_PRESETS, POST_SAMPLE_WIDTH };
  window.dispatchEvent(new CustomEvent('tb-post-ready'));
}
