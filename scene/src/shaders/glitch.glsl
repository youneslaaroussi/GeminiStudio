#version 300 es
precision highp float;

#include "@motion-canvas/core/shaders/common.glsl"

uniform float intensity; // 0.0 to 1.0

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
  vec2 uv = sourceUV;

  float glitchBlock = floor(uv.y * 20.0);
  float glitchTime = floor(time * 10.0);

  float blockRand = random(vec2(glitchBlock, glitchTime));
  if (blockRand > 0.9 - intensity * 0.4) {
    uv.x += (random(vec2(glitchTime, glitchBlock)) - 0.5) * 0.1 * intensity;
  }

  float splitAmount = 0.01 * intensity;
  vec4 rChannel = texture(sourceTexture, uv + vec2(splitAmount, 0.0));
  vec4 gChannel = texture(sourceTexture, uv);
  vec4 bChannel = texture(sourceTexture, uv - vec2(splitAmount, 0.0));

  vec4 color = vec4(rChannel.r, gChannel.g, bChannel.b, gChannel.a);

  float scanline = sin(uv.y * resolution.y * 2.0) * 0.04 * intensity;
  color.rgb += scanline;

  if (random(vec2(time, uv.y)) > 0.95 - intensity * 0.1) {
    color.rgb *= 0.5 + random(vec2(time)) * 0.5;
  }

  outColor = color;
}
