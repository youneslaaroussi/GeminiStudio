#version 300 es
precision highp float;

#include "@motion-canvas/core/shaders/common.glsl"

uniform float dissolveProgress; // 0 = start, 1 = end

void main() {
    vec4 color = texture(sourceTexture, sourceUV);

    // Add slight glow/brightness boost during middle of transition
    // This creates visual distinction from simple fade
    float midBoost = sin(dissolveProgress * 3.14159) * 0.15;
    color.rgb = color.rgb * (1.0 + midBoost);

    // Slightly desaturate during transition for a film-like dissolve feel
    float saturationReduction = sin(dissolveProgress * 3.14159) * 0.1;
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(color.rgb, vec3(gray), saturationReduction);

    outColor = color;
}
