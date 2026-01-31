#version 300 es
precision highp float;

#include "@motion-canvas/core/shaders/common.glsl"

void main() {
    vec4 color = texture(sourceTexture, sourceUV);
    // Convert luminance (brightness) to alpha
    // White pixels (high luminance) → high alpha (opaque)
    // Black pixels (low luminance) → low alpha (transparent)
    float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    outColor = vec4(color.rgb, luminance);
}
