#version 300 es
precision highp float;

#include "@motion-canvas/core/shaders/common.glsl"

uniform float blurAmount;

const float Pi = 6.28318530718;
const float Directions = 8.0;
const float Quality = 4.0;

void main() {
    vec4 color = texture(sourceTexture, sourceUV);

    if (blurAmount <= 0.0) {
        outColor = color;
        return;
    }

    vec2 radius = blurAmount / resolution.xy;
    float totalWeight = 1.0;

    for (float d = 0.0; d < Pi; d += Pi / Directions) {
        vec2 dir = vec2(cos(d), sin(d));

        for (float i = 1.0; i <= Quality; i++) {
            float dist = i / Quality;
            float weight = 1.0 - smoothstep(0.0, 1.0, dist);
            vec2 offset = dir * radius * dist;

            color += texture(sourceTexture, clamp(sourceUV + offset, 0.0, 1.0)) * weight;
            color += texture(sourceTexture, clamp(sourceUV - offset, 0.0, 1.0)) * weight;
            totalWeight += 2.0 * weight;
        }
    }

    outColor = color / totalWeight;
}
