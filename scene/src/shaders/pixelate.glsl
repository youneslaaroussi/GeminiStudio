#version 300 es
precision highp float;

#include "@motion-canvas/core/shaders/common.glsl"

uniform float pixelSize; // Size of pixels (1.0 to 100.0)

void main() {
  vec2 pixelUV = pixelSize / resolution;
  vec2 uv = floor(sourceUV / pixelUV) * pixelUV;
  outColor = texture(sourceTexture, uv);
}
