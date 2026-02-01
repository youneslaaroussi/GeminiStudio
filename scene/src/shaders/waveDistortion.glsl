#version 300 es
precision highp float;

#include "@motion-canvas/core/shaders/common.glsl"

uniform float amplitude; // 0.0 to 0.1
uniform float frequency; // 1.0 to 20.0
uniform float speed;     // 0.5 to 5.0

void main() {
  vec2 uv = sourceUV;

  float wave = sin(uv.y * frequency + time * speed) * amplitude;
  uv.x += wave;

  float vWave = sin(uv.x * frequency * 0.5 + time * speed * 0.7) * amplitude * 0.5;
  uv.y += vWave;

  outColor = texture(sourceTexture, uv);
}
