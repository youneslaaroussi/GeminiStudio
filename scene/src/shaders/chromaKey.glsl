#version 300 es
precision highp float;

#include "@motion-canvas/core/shaders/common.glsl"

// Key color (RGB 0–1)
uniform float keyR;
uniform float keyG;
uniform float keyB;
// How much color match to key (0–1). Higher = more pixels become transparent.
uniform float threshold;
// Feather at the edge (0–1). Higher = softer edge.
uniform float smoothness;

void main() {
  vec4 color = texture(sourceTexture, sourceUV);
  vec3 key = vec3(keyR, keyG, keyB);
  float d = distance(color.rgb, key);
  // Smoothstep: full opacity when d > threshold + smoothness, full transparent when d < threshold - smoothness
  float halfFeather = max(0.001, smoothness * 0.5);
  float alpha = 1.0 - smoothstep(threshold - halfFeather, threshold + halfFeather, d);
  outColor = vec4(color.rgb, color.a * (1.0 - alpha));
}
