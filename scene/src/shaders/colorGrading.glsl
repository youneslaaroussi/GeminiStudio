#version 300 es
precision highp float;

#include "@motion-canvas/core/shaders/common.glsl"

// Basic corrections
uniform float exposure;     // -2 to 2
uniform float contrast;     // -1 to 1 (normalized from -100 to 100)
uniform float saturation;   // 0 to 2 (1 = normal, normalized from -100 to 100)
uniform float temperature;  // -1 to 1 (normalized from -100 to 100)
uniform float tint;         // -1 to 1 (normalized from -100 to 100)
uniform float highlights;   // -1 to 1 (normalized from -100 to 100)
uniform float shadows;      // -1 to 1 (normalized from -100 to 100)

// Convert to linear space for more accurate color operations
vec3 srgbToLinear(vec3 srgb) {
  return pow(srgb, vec3(2.2));
}

vec3 linearToSrgb(vec3 linear) {
  return pow(linear, vec3(1.0 / 2.2));
}

void main() {
  vec4 color = texture(sourceTexture, sourceUV);
  vec3 rgb = color.rgb;

  // Convert to linear for more accurate processing
  rgb = srgbToLinear(rgb);

  // Exposure (multiply in linear space)
  rgb *= pow(2.0, exposure);

  // Shadows/Highlights adjustment
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  // Shadows affect dark areas (weight by inverse luminance)
  rgb += shadows * 0.3 * (1.0 - smoothstep(0.0, 0.5, luma));
  // Highlights affect bright areas (weight by luminance)
  rgb += highlights * 0.3 * smoothstep(0.5, 1.0, luma);

  // Convert back to sRGB for perceptual adjustments
  rgb = linearToSrgb(rgb);

  // Contrast (S-curve around midpoint)
  rgb = (rgb - 0.5) * (1.0 + contrast) + 0.5;

  // Saturation (lerp to luminance)
  float lumaPerceptual = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(lumaPerceptual), rgb, saturation);

  // Temperature (warm = +red -blue, cool = -red +blue)
  // Using a more subtle approach with color balance
  rgb.r += temperature * 0.1;
  rgb.b -= temperature * 0.1;
  // Slight green adjustment to maintain balance
  rgb.g += temperature * 0.02;

  // Tint (green/magenta shift)
  rgb.g += tint * 0.1;
  rgb.r -= tint * 0.03;
  rgb.b -= tint * 0.03;

  // Clamp to valid range
  rgb = clamp(rgb, 0.0, 1.0);

  outColor = vec4(rgb, color.a);
}
