#version 300 es
precision highp float;

#include "@motion-canvas/core/shaders/common.glsl"

uniform float amount;      // 0.0 to 1.0
uniform float directionX;  // X component of direction
uniform float directionY;  // Y component of direction

void main() {
  vec2 uv = sourceUV;

  vec2 offset = (uv - 0.5) * amount * 0.02;
  vec2 dirOffset = vec2(directionX, directionY) * amount * 0.01;

  float r = texture(sourceTexture, uv + offset + dirOffset).r;
  float g = texture(sourceTexture, uv).g;
  float b = texture(sourceTexture, uv - offset - dirOffset).b;
  float a = texture(sourceTexture, uv).a;

  outColor = vec4(r, g, b, a);
}
