#version 300 es
precision highp float;

in vec2 screenUV;
in vec2 sourceUV;
in vec2 destinationUV;

out vec4 outColor;

uniform float time;
uniform float deltaTime;
uniform float framerate;
uniform int frame;
uniform vec2 resolution;
uniform sampler2D sourceTexture;
uniform sampler2D destinationTexture;
uniform mat4 sourceMatrix;
uniform mat4 destinationMatrix;

uniform float Size;
uniform float Quality;
uniform float Directions;

const float Pi = 6.28318530718;

vec4 safeTexture(sampler2D tex, vec2 uv) {
    vec2 clampedUV = clamp(uv, 0.0, 1.0);
    return texture(tex, clampedUV);
}

void main() {
    vec2 radius = Size / resolution.xy;
    vec4 color = safeTexture(sourceTexture, sourceUV);
    float totalWeight = 1.0;

    for (float d = 0.0; d < Pi; d += Pi / Directions) {
        vec2 dir = vec2(cos(d), sin(d));

        for (float i = 1.0; i <= Quality; i++) {
            float dist = i / Quality;
            float weight = 1.0 - smoothstep(0.0, 1.0, dist);

            vec2 offset = dir * radius * dist;

            color += safeTexture(sourceTexture, sourceUV + offset) * weight;
            color += safeTexture(sourceTexture, sourceUV - offset) * weight;
            totalWeight += 2.0 * weight;
        }
    }

    outColor = color / totalWeight;
}
