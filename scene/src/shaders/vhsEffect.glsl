#version 300 es
precision highp float;

#include "@motion-canvas/core/shaders/common.glsl"

uniform float intensity; // 0.0 to 1.0

float random(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = sourceUV;

  float wobble = sin(uv.y * 10.0 + time * 2.0) * 0.003 * intensity;
  uv.x += wobble;

  float syncLine = step(0.98, random(vec2(time * 0.5, floor(uv.y * 100.0))));
  uv.x += syncLine * 0.05 * intensity;

  vec4 color;
  color.r = texture(sourceTexture, uv + vec2(0.002 * intensity, 0.0)).r;
  color.g = texture(sourceTexture, uv).g;
  color.b = texture(sourceTexture, uv - vec2(0.002 * intensity, 0.0)).b;
  color.a = texture(sourceTexture, uv).a;

  float scanline = sin(uv.y * resolution.y * 1.5) * 0.05;
  color.rgb -= scanline * intensity;

  color.rgb = mix(color.rgb, vec3(dot(color.rgb, vec3(0.299, 0.587, 0.114))), 0.1 * intensity);

  color.r *= 1.0 + 0.05 * intensity;
  color.b *= 1.0 - 0.05 * intensity;

  float noise = random(uv + time) * 0.08 * intensity;
  color.rgb += noise;

  float trackingBar = step(0.995, random(vec2(0.0, floor(time * 3.0))));
  float barPos = random(vec2(floor(time * 3.0), 0.0));
  if (abs(uv.y - barPos) < 0.05) {
    color.rgb *= 0.7 * trackingBar * intensity + (1.0 - trackingBar);
  }

  outColor = color;
}
