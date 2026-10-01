// GLSL for the canopy light field (WebGL 1, one fullscreen triangle): looking up through a gum canopy in the app's
// greens. Forest ground, late sun beyond the leaves, sickle-shaped gum leaves hanging in tufts from twigs in parallax
// layers, lit from behind like green glass (glowing edges, a shaded foreground) and swaying in a wind with travelling gusts, Sprout sun flecks where
// the canopy opens, and fine grain. Coordinates: px are CSS pixels from the viewport's top left (y down); world
// units are viewport heights, so the canopy keeps its scale on any screen.

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
  return sway * 0.4 + gust;
}

// A hanging gum leaf in its own space (y runs down the leaf from its stalk): long and lanceolate, curved like a
// sickle, with a drip tip and a short stalk. An approximate distance, which is all soft shading needs.
float leaf(vec2 q, float len, float halfW, float bend) {
  float t = clamp(q.y / len, 0.0, 1.0);
  float x = q.x - bend * len * t * t;
  float prof = pow(max(sin(3.14159 * pow(t, 0.62)), 0.0), 1.1) * (1.0 - 0.25 * t);
  float body = max(abs(x) - halfW * prof, max(-q.y, q.y - len));
  float stalk = max(abs(q.x) - halfW * 0.16, max(-q.y - len * 0.1, q.y - len * 0.04));
  return min(body, stalk);
}

// Sun flecks: small bright images of the sun where the canopy opens, twinkling as the leaves move over them.
float flecks(vec2 g, float t, float density) {
  vec2 c = floor(g);
  vec2 f = fract(g);
  vec2 h = hash22(c + 13.1);
  float on = step(1.0 - density, hash12(c + 2.7));
  float r = 0.06 + 0.1 * hash12(c + 5.3);
  vec2 dd = (f - (0.25 + 0.5 * h)) * vec2(1.0, 1.3);
  float d2 = dot(dd, dd);
  float core = 1.0 - smoothstep(r * r * 0.2, r * r, d2);
  float bloom = exp(-d2 / (r * r * 5.0)) * 0.35;
  float twinkle = 0.45 + 0.55 * sin(t * (0.6 + 1.7 * h.y) + h.x * 6.2831);
  return (core + bloom) * max(twinkle, 0.0) * on;
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

// Quiet zones: behind every block of text the flecks go out and the ground darkens, fading softly at the edges.
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

  // The late sun sits beyond the canopy, high to the right; light comes through in soft drifting openings.
  vec2 sun = vec2(aspect * 0.8, -0.2 + 0.05 * sin(sN * 0.6));
  float glow = exp(-length((w - sun) * vec2(0.75, 1.0)) * 1.7);
  float opening = smoothstep(0.42, 0.9, vnoise(w * 1.4 + vec2(t * 0.012, sN * 0.1)));
  float pool = pools(px);
  float L = clamp(glow * (0.45 + 0.75 * opening) + pool * 0.55, 0.0, 1.2);

  // The ground stays deep forest; the light is carried by the leaves it passes through.
  vec3 col = FOREST * 0.55 + OLIVE * 0.22 * glow + FERN * 0.16 * glow * glow + SPROUT * 0.1 * pow(glow, 4.0);
  col += (OLIVE * 0.22 + FERN * 0.1) * pool;

  vec2 bp = uBreeze.xy / uView.y;
  float open = 1.0;
  float glint = 0.0;
  for (int i = 0; i < 4; i++) {
    float li = float(i);
    if (li < 4.0 - uLayers) continue;
    float S = pick4(li, vec4(0.16, 0.24, 0.34, 0.5));
    float par = pick4(li, vec4(0.05, 0.11, 0.19, 0.3));
    float amp = pick4(li, vec4(0.05, 0.08, 0.11, 0.14));
    float blur = pick4(li, vec4(0.007, 0.0045, 0.0025, 0.007));
    float occl = pick4(li, vec4(0.15, 0.35, 0.75, 0.95));
    float near = li / 3.0;
    vec2 shift = vec2(li * 3.17, li * 1.31 + sN * par);
    vec2 p = w + shift;
    vec2 g = p / S;
    vec2 c0 = floor(g);
    float side = fract(g.x) < 0.5 ? -1.0 : 1.0;
    float best = 1e3;
    float face = 1.0;
    float mid = 1.0;
    float tint = 0.5;
    float twig = 1e3;
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      vec2 c = c0 + vec2(mod(fk, 2.0) * side, -floor(fk * 0.5));
      // Tufts gather in clumps, with open sky between them.
      if (hash12(c * 1.73 + li * 5.1) < 0.18 || vnoise(c * 0.45 + li * 7.0) < 0.28) continue;
      vec2 h = hash22(c + li * 17.3);
      float seed = hash12(c + li * 9.7 + 4.2);
      // A node at the end of a twig; a tuft of one to three gum leaves fans down from it.
      vec2 a = (c + vec2(0.1 + 0.8 * h.x, 0.04 + 0.36 * h.y)) * S;
      vec2 aw = a - shift;
      vec2 dB = aw + vec2(0.0, S * 0.4) - bp;
      float br = uBreeze.z * exp(-dot(dB, dB) / 0.04);
      float sway = amp * wind(aw, t + seed * 3.0) + br * (0.45 * uPush + 0.2 * sin(t * 12.0 + seed * 40.0));
      float base = (h.x - 0.5) * 0.6;
      // A short twig stub above the node, tapering away fast.
      vec2 tdir = normalize(vec2((seed - 0.5) * 1.4, -1.0));
      vec2 tq = p - a;
      float along = clamp(dot(tq, tdir), 0.0, S * 0.22);
      twig = min(twig, length(tq - tdir * along) + along * 0.03);
      for (int j = 0; j < 3; j++) {
        float fj = float(j) - 1.0;
        float sj = hash12(c + li * 3.9 + fj * 7.7 + 2.0);
        if (sj < 0.12 + 0.2 * abs(fj)) continue;
        float ang = base + sway + fj * (0.25 + 0.35 * seed) + (sj - 0.5) * 0.3 + 0.05 * sin(t * (0.9 + sj) + sj * 9.0);
        float len = S * (0.45 + 0.6 * sj) * (1.0 - 0.18 * abs(fj));
        float halfW = len * (0.065 + 0.035 * seed);
        float bend = fj * 0.3 + (sj - 0.5) * 0.5;
        vec2 q = p - a;
        float cs = cos(ang);
        float sn = sin(ang);
        q = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y);
        float tw = 0.45 + 0.55 * abs(cos(sj * 6.2831 + t * (0.25 + 0.3 * seed) + ang * 4.0 + br * 3.0));
        float d = leaf(q, len, halfW * tw, bend);
        if (d < best) {
          best = d;
          face = tw;
          tint = sj;
          float tt = clamp(q.y / len, 0.0, 1.0);
          mid = abs(q.x - bend * len * tt * tt) / max(halfW * tw, 1e-4);
        }
      }
    }
    float soft = blur + 1.2 / uRes.y;
    float m = 1.0 - smoothstep(-soft, soft, best);
    // Lit from behind, like green glass: brighter toward the edge, a pale midrib, a Sprout rim where the sun catches.
    // The nearest layer is the shaded foreground: a dark blade with only its rim lit. The farthest recedes into haze.
    float lightIn = 0.32 + 0.68 * L;
    float edge = smoothstep(-soft * 4.0 - 0.006, 0.0, best);
    vec3 glass = mix(OLIVE, FERN, 0.25 + 0.65 * tint) * face * lightIn * pick4(li, vec4(0.55, 0.95, 1.05, 0.38));
    vec3 leafCol = glass * (0.72 + 0.4 * edge);
    leafCol += SPROUT * edge * lightIn * face * pick4(li, vec4(0.05, 0.14, 0.24, 0.32));
    leafCol += SPROUT * 0.07 * (1.0 - smoothstep(0.0, 0.12, mid)) * lightIn * (1.0 - near * 0.6);
    leafCol = mix(leafCol, col, pick4(li, vec4(0.5, 0.2, 0.0, 0.0)));
    float tw0 = 0.0011 + 0.0012 * near;
    float tm = (1.0 - smoothstep(tw0, tw0 + soft, twig)) * step(0.5, li) * 0.45;
    col = mix(col, mix(FOREST * 0.4, OLIVE * 0.5, lightIn * (1.0 - near)), tm);
    col = mix(col, leafCol, m * pick4(li, vec4(0.55, 0.8, 0.95, 0.97)));
    glint = max(glint, edge * m * near * L);
    open *= 1.0 - max(m * occl, tm);
  }

  float q = quiet(px);
  float fl = flecks(w * 7.0 + vec2(t * 0.025, sN * 0.8), t, 0.26) + 0.55 * flecks(w * 13.0 + vec2(-t * 0.02, sN * 1.3) + 7.3, t * 1.3, 0.16);
  col += SPROUT * fl * open * smoothstep(0.14, 0.65, L) * (1.0 - q);
  col += SPROUT * glint * 0.3 * (0.5 + 0.5 * sin(t * 3.1 + w.x * 40.0)) * (1.0 - q);
  col = mix(col, FOREST * 0.5 + col * 0.22, q * 0.8);
  col += (hash12(gl_FragCoord.xy + fract(t * 7.13) * 371.0) - 0.5) * 0.03;
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`
