// GLSL for the canopy light field (WebGL 1, one fullscreen triangle): looking up into a gum canopy in the app's
// greens. One sun, high on the right beyond the leaves, lights the field as a broad gradient with shafts slanting
// down-left from it. Sickle-shaped gum leaves hang in clusters from drooping twigs, in parallax layers: the canopy is
// dense along the top edge and thins downward; far leaves are small and lit through like fern-green glass, near ones
// large, dark and soft with only their rims lit. Soft, irregular pools of Sprout light dapple the field and shimmer
// as the wind moves the leaves, with fine grain over everything. Coordinates: px are CSS pixels from the viewport's
// top left (y down); world units are viewport heights, so the canopy keeps its scale on any screen.

export const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

export const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;        // drawing buffer, px
uniform vec2 uView;       // CSS viewport, px
uniform float uTime;      // seconds
uniform float uScroll;    // camera, CSS px: drifts the view through the layers as the page scrolls
uniform vec3 uBreeze;     // the pointer as a breeze: x, y (CSS px), energy 0..1
uniform float uPush;      // which way the breeze blows, -1..1
uniform float uLayers;    // leaf layers: 4, or 3 in low power (the farthest goes)
uniform vec4 uPool[6];    // light pools: the paper clearings in view (x, y, w, h)
uniform float uPoolStr[6];
uniform vec4 uQuiet[8];   // quiet zones behind text (x, y, w, h)

const vec3 FOREST = vec3(0.0588, 0.1255, 0.0);   // #0f2000 on-primary-fixed
const vec3 OLIVE = vec3(0.2235, 0.3843, 0.0);    // #396200 primary
const vec3 FERN = vec3(0.302, 0.4863, 0.0588);   // #4d7c0f primary-container
const vec3 SPROUT = vec3(0.7333, 0.9529, 0.4863);// #bbf37c primary-fixed

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float pick4(float i, vec4 v) {
  return i < 0.5 ? v.x : (i < 1.5 ? v.y : (i < 2.5 ? v.z : v.w));
}

// The wind at a point: a slow sway, plus two gust fronts that travel across the canopy from the left.
float wind(vec2 a, float t) {
  float sway = 0.5 * sin(t * 0.42 + a.x * 0.9 + a.y * 0.4) + 0.3 * sin(t * 1.07 + a.x * 2.1 - a.y * 1.3);
  float span = uView.x / uView.y + 1.8;
  float g1 = (a.x - (fract(t * 0.043) * span - 0.9)) * 2.4;
  float g2 = (a.x - (fract(t * 0.043 + 0.53) * span - 0.9)) * 3.0;
  float gust = exp(-g1 * g1) * (0.65 + 0.35 * sin(t * 0.23)) + 0.75 * exp(-g2 * g2);
  return sway * 0.45 + gust * 1.2;
}

// A hanging gum leaf in its own space (y runs down from where the petiole meets the twig): a short petiole, then a
// long narrow blade on a curved midrib (the sickle), widest a third of the way down, its convex side a little fuller,
// drawn out to a fine tip. Returns an approximate distance (enough for soft shading) and the distance from the
// midrib as a fraction of the half-width.
vec2 leaf(vec2 q, float len, float halfW, float bend) {
  float pet = len * 0.12;
  float bl = len - pet;
  float y = q.y - pet;
  float t = clamp(y / bl, 0.0, 1.0);
  float x = q.x - bend * bl * t * t;
  float slope = 2.0 * bend * t;
  float prof = pow(sin(3.14159 * pow(t, 0.6)), 1.25) * (1.0 - 0.3 * t);
  float w = halfW * prof * (x * bend < 0.0 ? 1.18 : 0.85);
  float body = max((abs(x) - w) / sqrt(1.0 + slope * slope), max(-y, y - bl));
  float stalk = max(abs(q.x) - halfW * 0.13, max(-q.y, y - len * 0.02));
  return vec2(min(body, stalk), abs(x) / max(w, 1e-4));
}

// Light finds the work: the canopy brightens round each paper clearing in view.
float pools(vec2 px) {
  float s = 0.0;
  float reach = 0.18 * uView.y + 60.0;
  for (int i = 0; i < 6; i++) {
    vec4 r = uPool[i];
    if (r.z > 0.0) {
      float d = sdBox(px - (r.xy + r.zw * 0.5), r.zw * 0.5);
      s += uPoolStr[i] * exp(-max(d, 0.0) / reach);
    }
  }
  return min(s, 1.3);
}

// Quiet zones: behind every block of text the dapples go out and the ground darkens, fading softly at the edges.
float quiet(vec2 px) {
  float q = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 r = uQuiet[i];
    if (r.z > 0.0) {
      float d = sdBox(px - (r.xy + r.zw * 0.5), r.zw * 0.5 + 24.0) - 24.0;
      q = max(q, 1.0 - smoothstep(0.0, 170.0, d));
    }
  }
  return q;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) * (uView / uRes);
  float aspect = uView.x / uView.y;
  vec2 w = px / uView.y;
  float t = uTime;
  float sN = uScroll / uView.y;

  // The sun, high on the right beyond the canopy: a broad gradient across the field, and shafts fanning down-left.
  vec2 ds = w - vec2(aspect * 0.86, -0.34 + 0.04 * sin(sN * 0.6));
  float r = length(ds * vec2(0.8, 1.0));
  float glow = exp(-r * 1.0);
  float ang = atan(ds.y, ds.x);
  float shaft = 0.6 * vnoise(vec2(ang * 9.0 + t * 0.02, 1.7)) + 0.4 * vnoise(vec2(ang * 23.0 - t * 0.035, 8.3));
  shaft = smoothstep(0.4, 0.85, shaft) * smoothstep(0.1, 0.55, r) * exp(-r * 0.6);
  float pool = pools(px);
  float L = clamp(glow + 0.35 * shaft + 0.55 * pool, 0.0, 1.3);

  vec3 col = FOREST * 0.42 + OLIVE * 0.34 * glow * glow + FERN * 0.3 * glow * glow + SPROUT * 0.18 * pow(glow, 4.0);
  col += (FERN * 0.22 + SPROUT * 0.06) * shaft;
  col += (OLIVE * 0.22 + FERN * 0.1) * pool;

  vec2 bp = uBreeze.xy / uView.y;
  float open = 1.0;
  for (int i = 0; i < 4; i++) {
    float li = float(i);
    if (li < 4.0 - uLayers) continue;
    // Layer 0 is the farthest: small, high and lit through; layer 3 the nearest: large, low on the top edge, dark.
    float S = pick4(li, vec4(0.15, 0.22, 0.32, 0.52));
    float par = pick4(li, vec4(0.05, 0.11, 0.19, 0.3));
    float amp = pick4(li, vec4(0.07, 0.1, 0.13, 0.16));
    float blur = pick4(li, vec4(0.0035, 0.0022, 0.003, 0.012));
    float occl = pick4(li, vec4(0.1, 0.3, 0.6, 0.95));
    float yTop = pick4(li, vec4(0.15, 0.05, -0.02, -0.06));
    float yBot = pick4(li, vec4(0.95, 0.75, 0.55, 0.34));
    float soft = blur + 1.2 / uRes.y;
    vec2 shift = vec2(li * 3.17, li * 1.31 + sN * par);
    vec2 p = w + shift;
    // Each layer's twig grid is turned a little, alternately, so the canopy never settles into rows.
    float gr = pick4(li, vec4(0.28, -0.22, 0.3, -0.26));
    vec2 gx = vec2(cos(gr), sin(gr));
    vec2 gy = vec2(-gx.y, gx.x);
    vec2 c0 = floor(vec2(dot(p, gx), dot(p, gy)) / S);
    float best = 1e3;
    float fade = 0.0;
    float face = 1.0;
    float mid = 1.0;
    float tint = 0.5;
    float tm = 0.0;
    // A twig's leaves reach at most 1.45 S from its anchor and at most 1.25 S sideways or 0.2 S up, and anchors sit
    // 0.3-0.7 across and 0.25-0.5 down their cell, so this cell, its two side neighbours and the three above hold
    // every leaf that can cover this pixel: no leaf is ever cut at a cell edge.
    for (int k = 0; k < 6; k++) {
      float fk = float(k);
      float row = floor((fk + 0.5) / 3.0);
      vec2 c = c0 + vec2(fk - 3.0 * row - 1.0, -row);
      vec2 h = hash22(c + li * 17.3);
      float seed = hash12(c + li * 9.7 + 4.2);
      vec2 ag = (c + vec2(0.3 + 0.4 * h.x, 0.25 + 0.25 * h.y)) * S;
      vec2 a = ag.x * gx + ag.y * gy;
      vec2 aw = a - shift;
      // Dense along the top edge, thinning downward, in clumps; a twig fades rather than pops as the camera drifts.
      float dens = (1.0 - smoothstep(yTop, yBot, aw.y)) * (0.45 + 0.8 * vnoise(c * 0.5 + li * 7.0));
      float pres = smoothstep(seed - 0.08, seed + 0.08, dens);
      vec2 tq = p - a;
      if (pres < 0.01 || dot(tq, tq) > S * S * 2.1) continue;
      vec2 dB = aw + vec2(0.0, S * 0.45) - bp;
      float br = uBreeze.z * exp(-dot(dB, dB) / 0.05);
      float sway = amp * wind(aw, t + seed * 3.0) + br * (0.45 * uPush + 0.18 * sin(t * 11.0 + seed * 40.0));
      // The twig: a short drooping stem, tilted, bending a little with the wind.
      float span = S * (0.18 + 0.1 * h.y);
      float tilt = (seed - 0.5) * 0.5 + sway * 0.15;
      float droop = S * 0.07;
      float sx = clamp(tq.x, -span, span);
      float u = sx / span;
      float twd = length(vec2(tq.x - sx, tq.y - tilt * sx - droop * u * u)) - S * 0.016 * (1.0 - 0.6 * abs(u));
      tm = max(tm, (1.0 - smoothstep(-soft, soft, twd)) * pres);
      for (int j = 0; j < 3; j++) {
        float fj = float(j) - 1.0;
        float sj = hash12(c + li * 3.9 + fj * 7.7 + 2.0);
        if (sj < 0.1 + 0.15 * abs(fj)) continue;
        // Leaves hang alternately along the twig, pendulous, each at its own angle, each turning on its petiole.
        float lx = span * (fj * 0.8 + (sj - 0.5) * 0.25);
        float lu = lx / span;
        vec2 at = a + vec2(lx, tilt * lx + droop * lu * lu);
        float la = clamp((h.x - 0.5) * 0.9 + -fj * (0.2 + 0.25 * seed) + (sj - 0.5) * 0.35 + sway + 0.06 * sin(t * (0.8 + sj) + sj * 9.0), -0.85, 0.85);
        float len = S * (0.55 + 0.4 * sj) * (1.0 - 0.12 * abs(fj));
        float halfW = len * (0.085 + 0.03 * seed);
        float bend = (fract(sj * 7.3) > 0.5 ? 1.0 : -1.0) * (0.16 + 0.12 * fract(sj * 13.1));
        vec2 q = p - at;
        float cs = cos(la);
        float sn = sin(la);
        q = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y);
        float tw = 0.72 + 0.28 * abs(cos(sj * 6.2831 + t * (0.2 + 0.25 * seed) + la * 3.0 + br * 3.0));
        vec2 lf = leaf(q, len, halfW * tw, bend);
        float d = lf.x + (1.0 - pres) * S * 0.04;
        if (d < best) {
          best = d;
          fade = pres;
          face = tw;
          tint = sj;
          mid = lf.y;
        }
      }
    }
    float m = (1.0 - smoothstep(-soft, soft, best)) * fade;
    float near = li / 3.0;
    float edge = smoothstep(-soft * 3.0 - 0.004 * (1.0 + 2.0 * near), 0.0, best);
    // Far leaves are lit through, olive to fern, brightest toward the sun, with a pale midrib and a Sprout rim;
    // near leaves are the shaded foreground, dark and soft, only their rims catching the light.
    vec3 lit = mix(OLIVE, FERN, 0.3 + 0.6 * tint) * (0.45 + 0.85 * L) * (0.6 + 0.4 * face);
    lit += SPROUT * (0.05 + 0.22 * L) * edge * face;
    lit += SPROUT * 0.08 * L * (1.0 - smoothstep(0.0, 0.14, mid));
    vec3 shade = FOREST * 0.32 + OLIVE * 0.1 * L + SPROUT * 0.14 * L * edge * face;
    vec3 leafCol = mix(lit, shade, pick4(li, vec4(0.0, 0.1, 0.45, 0.9)));
    leafCol = mix(leafCol, col, pick4(li, vec4(0.45, 0.2, 0.05, 0.0)));
    col = mix(col, mix(leafCol * 0.7, shade, 0.5), tm * pick4(li, vec4(0.3, 0.5, 0.7, 0.9)));
    col = mix(col, leafCol, m * pick4(li, vec4(0.7, 0.85, 0.95, 0.97)));
    open *= 1.0 - max(m, tm) * occl;
  }

  // Dapples: soft, irregular, overlapping pools of sunlight, longer than wide under a high sun, strongest where the
  // light is, drifting and shimmering as the wind moves the leaves that cast them. Continuous noise, so no seams.
  float q = quiet(px);
  vec2 wv = vec2(0.035 * wind(w, t) + 0.012 * sin(t * 0.9 + w.y * 5.0), 0.012 * cos(t * 0.7 + w.x * 4.0));
  vec2 dp = (w + vec2(t * 0.008, sN * 0.5) + wv) * vec2(1.0, 0.7);
  float n = 0.58 * vnoise(dp * 6.1) + 0.42 * vnoise(mat2(0.8, -0.6, 0.6, 0.8) * dp * 13.3 + 5.3);
  float dap = smoothstep(0.6, 0.8, n);
  float shimmer = 0.68 + 0.32 * vnoise(w * 21.0 + vec2(t * 1.5, -t * 1.1));
  col += SPROUT * dap * shimmer * open * smoothstep(0.12, 0.9, L) * 0.62 * (1.0 - q);
  col = mix(col, FOREST * 0.5 + col * 0.22, q * 0.8);
  col += (hash12(gl_FragCoord.xy + fract(t * 7.13) * 371.0) - 0.5) * 0.03;
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`
