#version 300 es
precision highp float;

#include "@motion-canvas/core/shaders/common.glsl"

uniform float zoomStrength;  // 0 = no zoom, 1 = full zoom effect
uniform float zoomDirection; // 1 = zoom in, -1 = zoom out

const int samples = 12;

void main() {
    vec2 center = vec2(0.5, 0.5);
    vec2 dir = sourceUV - center;

    vec4 color = vec4(0.0);
    float totalWeight = 0.0;

    float strength = zoomStrength * 0.15 * zoomDirection;

    for (int i = 0; i < samples; i++) {
        float t = float(i) / float(samples - 1);
        float weight = 1.0 - abs(t - 0.5) * 2.0; // Weight peaks at center sample

        vec2 offset = dir * strength * t;
        vec2 sampleUV = clamp(sourceUV - offset, 0.0, 1.0);

        color += texture(sourceTexture, sampleUV) * weight;
        totalWeight += weight;
    }

    outColor = color / totalWeight;
}
