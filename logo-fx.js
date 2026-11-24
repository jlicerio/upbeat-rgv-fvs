/* One owner for logo FX modes, defaults, palettes, controls and the GPU pass. */
export const LOGO_FX = {
  modes: [
    ['off', 'Off'],
    ['thermal', 'Radial Thermal'],
    ['cyan', 'Cyan Halation'],
    ['stipple', 'Stipple Bloom'],
    ['hourglass', 'Hourglass Chrome']
  ],
  modePalettes: {
    thermal: { colorCore: '#fff2bd', colorMid: '#ff7014', colorOuter: '#d60d24' },
    cyan: { colorCore: '#dbfeff', colorMid: '#29c2fa', colorOuter: '#144ee0' },
    stipple: { colorCore: '#f2fcff', colorMid: '#1fa8ff', colorOuter: '#002eff' },
    hourglass: { colorCore: '#f2f7ff', colorMid: '#b8c4e0', colorOuter: '#4c5266' }
  },
  palettes: [
    { name: 'Thermal', colorCore: '#fff2bd', colorMid: '#ff7014', colorOuter: '#d60d24' },
    { name: 'Cyan', colorCore: '#dbfeff', colorMid: '#29c2fa', colorOuter: '#144ee0' },
    { name: 'Cobalt', colorCore: '#f2fcff', colorMid: '#1fa8ff', colorOuter: '#002eff' },
    { name: 'Chrome', colorCore: '#f2f7ff', colorMid: '#b8c4e0', colorOuter: '#4c5266' },
    { name: 'Ultraviolet', colorCore: '#fff0ff', colorMid: '#c855ff', colorOuter: '#4d08d6' },
    { name: 'Acid', colorCore: '#f4ffbd', colorMid: '#7dff2b', colorOuter: '#058c42' },
    { name: 'Infrared', colorCore: '#ffe6f4', colorMid: '#ff2478', colorOuter: '#6e0046' },
    { name: 'Gold', colorCore: '#fff8d6', colorMid: '#ffbe2e', colorOuter: '#9e3e00' }
  ],
  defaults: {
    mode: 'off',
    intensity: 1.0,
    spread: 0.76,
    grain: 0.62,
    colorCore: '#fff2bd',
    colorMid: '#ff7014',
    colorOuter: '#d60d24'
  },
  ranges: {
    intensity: [0, 1, 0.01],
    spread: [0, 1, 0.01],
    grain: [0, 1, 0.01]
  },
  colors: [
    ['colorCore', 'Core'],
    ['colorMid', 'Mid'],
    ['colorOuter', 'Outer']
  ]
};

function hexToRgb(hex) {
  const h = (hex || '#ffffff').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  if (Number.isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const VERT = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;

uniform sampler2D src;
uniform vec2 res;
uniform float mode;
uniform float intensity;
uniform float spread;
uniform float grain;
uniform float time;
uniform vec3 colorCore;
uniform vec3 colorMid;
uniform vec3 colorOuter;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i + vec2(0.0, 0.0)), hash12(i + vec2(1.0, 0.0)), u.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float filmGrain(vec2 fc, float t) {
  float gFine = hash12(fc + floor(t * 14.0) * 19.7) - 0.5;
  float gCoarse = hash12(floor(fc * 0.5) + floor(t * 10.0) * 7.3) - 0.5;
  float gSoft = vnoise(fc * 0.22 + vec2(t * 1.5, 4.2)) - 0.5;
  return gFine * 0.50 + gCoarse * 0.32 + gSoft * 0.18;
}

vec4 sampleSrc(vec2 q) {
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
  return texture(src, q);
}

float lum(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

/* Sample ONLY logo opacity/brightness so background video is never touched */
float maskAt(vec2 q) {
  vec4 s = sampleSrc(q);
  return clamp(s.a * smoothstep(0.03, 0.42, max(lum(s.rgb), s.a * 0.75)), 0.0, 1.0);
}

float softMaskAt(vec2 q, float rad, float aspect) {
  float acc = maskAt(q) * 0.24;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.78539816;
    acc += maskAt(q + vec2(cos(a) / aspect, sin(a)) * rad) * 0.095;
  }
  return acc;
}

vec2 rotUV(vec2 q, float angle, float scale, float aspect) {
  vec2 p = q - 0.5;
  vec2 pa = vec2(p.x * aspect, p.y) / max(scale, 0.2);
  float ca = cos(angle), sa = sin(angle);
  vec2 r = vec2(pa.x * ca - pa.y * sa, pa.x * sa + pa.y * ca);
  return vec2(r.x / aspect, r.y) + 0.5;
}

/* 1. Radial Thermal Echo (transparent over background) */
vec4 fxThermal(vec2 q, float aspect) {
  float pulse = 1.0 + 0.07 * sin(time * 2.4);
  float maxA = (0.36 + 0.62 * spread) * pulse;
  float blurR = 0.008 + 0.014 * spread;

  float smear = 0.0;
  float wsum = 0.0;
  const int STEPS = 36;
  for (int i = -STEPS; i <= STEPS; i++) {
    float t = float(i) / float(STEPS);
    float a = t * maxA;
    float sc = 1.0 + abs(t) * 0.08 * spread;
    vec2 sp = rotUV(q, a, sc, aspect);
    float w = exp(-t * t * 2.6);
    smear += maskAt(sp) * w;
    wsum += w;
  }
  smear = (smear / max(wsum, 0.001)) * 1.85;

  float echoes = 0.0;
  for (int k = 1; k <= 4; k++) {
    float kf = float(k) / 4.0;
    float ang = kf * maxA * 0.92;
    float sc = 1.0 + kf * 0.14 * spread;
    float decay = exp(-kf * 1.45) * 0.85;
    float rBlur = blurR * (0.6 + kf * 1.4);
    float ePos = softMaskAt(rotUV(q, ang, sc, aspect), rBlur, aspect);
    float eNeg = softMaskAt(rotUV(q, -ang, sc, aspect), rBlur, aspect);
    echoes = max(echoes, max(ePos, eNeg) * decay);
  }

  float coreSharp = maskAt(q);
  float coreSoft = softMaskAt(q, blurR * 0.9, aspect);
  float core = max(coreSharp * 0.92, coreSoft * 1.05);

  float gr = filmGrain(gl_FragCoord.xy, time);
  float heat = clamp(max(core * 1.02, max(smear * 0.78, echoes * 0.96)), 0.0, 1.0);
  heat = clamp(heat + gr * (0.10 + 0.24 * grain) * smoothstep(0.02, 0.75, heat), 0.0, 1.0);

  vec3 col = mix(colorOuter * 0.45, colorOuter, smoothstep(0.06, 0.46, heat));
  col = mix(col, colorMid, smoothstep(0.42, 0.76, heat));
  col = mix(col, colorCore, smoothstep(0.72, 0.96, heat));
  col += gr * (0.10 + 0.22 * grain) * smoothstep(0.05, 0.8, heat);

  float alpha = smoothstep(0.03, 0.26, heat);
  return vec4(max(vec3(0.0), col), alpha);
}

/* 2. Cyan Halation Streak (transparent over background) */
vec4 fxCyan(vec2 q, float aspect) {
  float rIn = 0.006 + 0.010 * spread;
  float rOut = 0.018 + 0.032 * spread;

  float c = maskAt(q);
  float dilated = c;
  float eroded = c;
  float softBlur = 0.0;
  const int R = 16;
  for (int i = 0; i < R; i++) {
    float a = float(i) * (6.2831853 / float(R));
    vec2 dir = vec2(cos(a) / aspect, sin(a));
    float s1 = maskAt(q + dir * rIn);
    float s2 = maskAt(q + dir * rOut);
    dilated = max(dilated, s1);
    eroded = min(eroded, s1);
    softBlur += s1 * 0.55 + s2 * 0.45;
  }
  softBlur /= float(R);

  float interior = smoothstep(0.28, 0.80, eroded);
  float rim = clamp(softMaskAt(q, rIn * 0.9, aspect) * 1.25 - interior * 0.92, 0.0, 1.0);
  float halation = clamp(smoothstep(0.03, 0.68, softBlur) * (1.0 - interior * 0.65), 0.0, 1.0);

  float smear = 0.0;
  float streakStep = (0.007 + 0.016 * spread) / max(aspect, 0.6);
  float fiber = 0.52 + 0.48 * vnoise(vec2(q.x * 6.5 + time * 0.4, q.y * 150.0));
  const int S = 32;
  for (int i = 1; i <= S; i++) {
    float fi = float(i);
    float w = exp(-fi * 0.075);
    float jy = (hash12(vec2(fi, floor(gl_FragCoord.y))) - 0.5) * 0.008 * spread;
    smear += maskAt(q + vec2(fi * streakStep, jy)) * w;
  }
  smear = clamp((smear / 7.5) * fiber, 0.0, 1.35);

  float ghost = 0.0;
  for (int k = 1; k <= 3; k++) {
    float kf = float(k);
    vec2 off = vec2(kf * (0.045 + 0.065 * spread) / max(aspect, 0.6), 0.0);
    ghost += softMaskAt(q + off, 0.012 * kf, aspect) * exp(-kf * 0.85) * 0.55;
  }

  float scan = 0.74 + 0.26 * sin(gl_FragCoord.y * 2.2);
  float gr = filmGrain(gl_FragCoord.xy, time);

  vec3 col = vec3(0.0);
  col += colorOuter * 0.26 * interior * (0.68 + 0.32 * scan);
  col += mix(colorOuter, colorMid, 0.55) * halation * 1.15;
  col += colorMid * (smear * 0.95 + ghost * 0.75) * scan;
  col += colorCore * pow(smear, 2.0) * 0.65;
  col += colorCore * rim * 1.25;

  float glowMask = clamp(max(dilated, max(halation * 0.95, max(smear * 0.95, ghost * 0.8))), 0.0, 1.0);
  col += gr * (0.14 + 0.30 * grain) * glowMask;
  float alpha = smoothstep(0.02, 0.24, glowMask);
  return vec4(max(vec3(0.0), col), alpha);
}

/* 3. Electric Stipple Bloom (transparent over background) */
vec4 fxStipple(vec2 q, float aspect) {
  float c = maskAt(q);
  float bloom = c * 0.25;
  float wsum = 0.25;
  float maxR = 0.036 + 0.062 * spread;

  const int RINGS = 4;
  const int ARMS = 14;
  for (int r = 1; r <= RINGS; r++) {
    float rf = float(r) / float(RINGS);
    float rad = maxR * rf;
    float w = exp(-rf * 1.6);
    for (int i = 0; i < ARMS; i++) {
      float a = float(i) * (6.2831853 / float(ARMS)) + rf * 0.42;
      vec2 off = vec2(cos(a) / aspect, sin(a)) * rad;
      bloom += maskAt(q + off) * w;
      wsum += w;
    }
  }
  bloom /= wsum;

  float nFine = hash12(floor(gl_FragCoord.xy) + floor(time * 8.0) * 3.1);
  float nMed = hash12(floor(gl_FragCoord.xy * 0.5) + 17.3);
  float nClump = vnoise(gl_FragCoord.xy * 0.14 + vec2(3.1, 7.4));
  float spatter = nFine * 0.46 + nMed * 0.34 + nClump * 0.20;

  float gAmt = 0.42 + 0.65 * grain;
  float outerField = clamp(bloom * 1.85 + (spatter - 0.50) * gAmt * 1.35, 0.0, 1.0);
  float cobaltMask = smoothstep(0.10, 0.58, outerField) * smoothstep(0.015, 0.10, bloom);
  float cyanMask = smoothstep(0.34, 0.78, outerField) * smoothstep(0.03, 0.16, bloom);
  float coreField = max(c * 0.98, bloom * 1.28) - (1.0 - spatter) * (0.28 + 0.46 * grain);
  float coreMask = smoothstep(0.36, 0.78, coreField);

  float spark = step(0.80 - grain * 0.16, nFine) * smoothstep(0.03, 0.48, bloom) * (1.0 - coreMask * 0.7);
  float coreGrain = (nFine - 0.5) * (0.14 + 0.24 * grain) * coreMask;

  vec3 col = colorOuter;
  col = mix(col, colorMid, cyanMask);
  col = mix(col, colorCore, coreMask);
  col += mix(colorMid, colorCore, 0.35) * spark * 0.95 + vec3(coreGrain);

  float alpha = clamp(max(cobaltMask, max(coreMask, spark * 0.9)), 0.0, 1.0);
  return vec4(max(vec3(0.0), col), alpha);
}

/* 4. Hourglass Chrome Tunnel (transparent over background) */
vec4 fxHourglass(vec2 q, float aspect) {
  float dy = abs(q.y - 0.5) * 2.0;
  float gr = filmGrain(gl_FragCoord.xy, time);

  float capStart = 0.68;
  float capEnd = 0.95;
  float inCap = step(capStart, dy) * step(dy, capEnd);
  float capV = (dy - capStart) / (capEnd - capStart);
  float srcYCap = mix(0.20, 0.80, capV);
  float srcXCap = (q.x - 0.5) * 0.92 + 0.5;
  vec4 capSample = sampleSrc(vec2(srcXCap, srcYCap));
  float capMask = smoothstep(0.06, 0.24, capSample.a);

  float tY = clamp(dy / capStart, 0.0, 1.0);
  float waistWidth = mix(0.46 - 0.22 * spread, 1.0, pow(tY, 1.85));
  float tunnelX = (q.x - 0.5) / max(waistWidth, 0.14) * 0.92 + 0.5;

  vec3 extrude = vec3(0.0);
  float rimAccum = 0.0;
  float blurX = (0.004 + 0.014 * spread) * (1.35 - tY * 0.85) / max(aspect, 0.6);
  for (int j = -2; j <= 2; j++) {
    float wx = exp(-float(j * j) * 0.45);
    float sx = tunnelX + float(j) * blurX;
    vec3 colMax = vec3(0.0);
    float rSum = 0.0;
    for (int i = 0; i < 6; i++) {
      float sy = mix(0.22, 0.78, float(i) / 5.0);
      vec4 s = sampleSrc(vec2(sx, sy));
      colMax = max(colMax, s.rgb * s.a);
      rSum += s.a;
    }
    extrude += colMax * wx;
    rimAccum += (rSum / 6.0) * wx;
  }
  extrude /= 3.35;
  rimAccum /= 3.35;

  float echoWave = 0.86 + 0.14 * sin(tY * 18.0 - time * 2.2);
  float shimmer = 0.90 + 0.10 * sin(time * 1.8 + tunnelX * 8.0 + tY * 4.0);
  float fade = pow(tY, 1.35);
  float edgeLine = smoothstep(0.06, 0.24, rimAccum) * (1.0 - smoothstep(0.24, 0.55, rimAccum));
  vec3 tunnelTint = mix(colorOuter, colorMid, 0.35 + 0.65 * fade);
  vec3 tunnelCol = extrude * tunnelTint * fade * 0.95 * shimmer * echoWave;
  tunnelCol += mix(colorMid, colorCore, 0.4) * edgeLine * (0.28 + 0.52 * fade);

  float tunnelAlpha = clamp(smoothstep(0.02, 0.26, lum(tunnelCol) + edgeLine * 0.35) * (0.30 + 0.70 * fade), 0.0, 0.96);
  vec3 chromeBoost = pow(max(capSample.rgb, vec3(0.0)), vec3(0.88)) * colorCore * 1.12;

  float capA = inCap * capMask;
  float alpha = max(tunnelAlpha, capA);
  vec3 col = mix(tunnelCol, chromeBoost, capA) + gr * (0.10 + 0.20 * grain) * alpha;
  return vec4(max(vec3(0.0), col), alpha);
}

void main() {
  vec4 base = sampleSrc(uv);
  float aspect = res.x / max(res.y, 1.0);
  vec4 effect = base;

  if (mode > 0.5 && mode < 1.5) {
    effect = fxThermal(uv, aspect);
  } else if (mode >= 1.5 && mode < 2.5) {
    effect = fxCyan(uv, aspect);
  } else if (mode >= 2.5 && mode < 3.5) {
    effect = fxStipple(uv, aspect);
  } else if (mode >= 3.5) {
    effect = fxHourglass(uv, aspect);
  }

  vec3 rgb = mix(base.rgb, effect.rgb, intensity);
  float a = clamp(mix(base.a, effect.a, intensity), 0.0, 1.0);
  /* Premultiplied alpha output avoids WebGL gray-field compositing bugs */
  outColor = vec4(rgb * a, a);
}`;

export class LogoFX {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = (this.gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true
    }));
    if (!gl) throw new Error('Logo FX needs WebGL2');

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) || 'Logo FX shader compile failed');
      }
      return sh;
    };

    const program = (this.program = gl.createProgram());
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Logo FX program link failed');
    }

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.vao = gl.createVertexArray();
  }

  render(source, w, h, t, state) {
    const gl = this.gl;
    const c = this.canvas;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    const u = (n) => gl.getUniformLocation(this.program, n);
    gl.uniform1i(u('src'), 0);
    gl.uniform2f(u('res'), w, h);
    const modeIdx = Math.max(0, LOGO_FX.modes.findIndex((x) => x[0] === state.mode));
    gl.uniform1f(u('mode'), modeIdx);
    gl.uniform1f(u('intensity'), state.intensity);
    gl.uniform1f(u('spread'), state.spread);
    gl.uniform1f(u('grain'), state.grain);
    gl.uniform1f(u('time'), t);
    gl.uniform3fv(u('colorCore'), hexToRgb(state.colorCore));
    gl.uniform3fv(u('colorMid'), hexToRgb(state.colorMid));
    gl.uniform3fv(u('colorOuter'), hexToRgb(state.colorOuter));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

window.LogoFX = { LogoFX, LOGO_FX };
window.dispatchEvent(new Event('logo-fx-ready'));
