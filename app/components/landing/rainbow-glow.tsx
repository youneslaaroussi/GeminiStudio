'use client';

import { useRef, useEffect } from 'react';

interface RainbowGlowProps {
  position?: 'top' | 'bottom';
}

export function RainbowGlow({ position = 'bottom' }: RainbowGlowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl');
    if (!gl) return;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(
      vertexShader,
      `
      attribute vec2 pos;
      varying vec2 uv;
      void main() {
        uv = pos * 0.5 + 0.5;
        gl_Position = vec4(pos, 0.0, 1.0);
      }
    `
    );
    gl.compileShader(vertexShader);

    const isTop = position === 'top';
    const distFromEdgeExpr = isTop ? 'p.y' : '1.0 - p.y';
    const borderYExpr = isTop ? '1.0 - p.y' : 'p.y';
    // Fade at bottom of canvas (top position) or top of canvas (bottom position) to blend with page
    const bottomFadeExpr = isTop ? 'smoothstep(0.0, 0.5, p.y)' : 'smoothstep(0.0, 0.5, 1.0 - p.y)';

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(
      fragmentShader,
      `
      precision mediump float;
      varying vec2 uv;
      uniform float time;
      uniform vec2 resolution;

      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      void main() {
        vec2 p = uv;
        float distFromEdge = ${distFromEdgeExpr};
        float reflectedDist = abs(distFromEdge);
        float wavePhase1 = reflectedDist * 15.0 + time * 0.8;
        float wavePhase2 = reflectedDist * 20.0 + time * 1.2 + 1.5;
        float wavePhase3 = reflectedDist * 10.0 + time * 0.5 + 3.0;
        float reflectionFactor = smoothstep(0.0, 0.15, distFromEdge);
        float wave1 = sin(wavePhase1) * 0.5 + 0.5;
        float wave2 = sin(wavePhase2) * 0.5 + 0.5;
        float wave3 = sin(wavePhase3) * 0.5 + 0.5;
        float interference = sin((distFromEdge * 25.0 + time * 1.0) * reflectionFactor) * 0.3 + 0.7;
        float glow = (wave1 * 0.35 + wave2 * 0.35 + wave3 * 0.3) * interference;
        float hue = fract(time * 0.15 + p.x * 0.4 + distFromEdge * 0.6);
        float fade = pow(distFromEdge, 0.4);
        float borderY = ${borderYExpr};
        float borderReflection = smoothstep(0.95, 1.0, borderY) * 1.5;
        float intensity = (glow * fade + borderReflection) * 2.5;
        float horizontalWave = sin(p.x * 5.0 + time * 0.6) * 0.15 + 0.85;
        intensity *= horizontalWave;
        float saturation = 1.0;
        float brightness = intensity * 1.5;
        vec3 color = hsv2rgb(vec3(hue, saturation, brightness));
        float borderGlow = smoothstep(0.92, 1.0, borderY);
        vec3 borderColor = hsv2rgb(vec3(fract(time * 0.2 + p.x * 0.5), 1.0, 1.0));
        color = mix(color, borderColor, borderGlow * 0.6);
        color += vec3(0.8, 0.8, 0.8) * borderGlow * 0.8;
        float alpha = intensity * 1.2;
        float bottomFade = ${bottomFadeExpr};
        alpha *= bottomFade;
        gl_FragColor = vec4(color, min(alpha, 1.0));
      }
    `
    );
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      console.error('Vertex shader error:', gl.getShaderInfoLog(vertexShader));
      return;
    }
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      console.error('Fragment shader error:', gl.getShaderInfoLog(fragmentShader));
      return;
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program linking error:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const pos = gl.getAttribLocation(program, 'pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    const timeUniform = gl.getUniformLocation(program, 'time');
    const resolutionUniform = gl.getUniformLocation(program, 'resolution');
    let animationId: number;

    const render = (t: number) => {
      gl.uniform1f(timeUniform, t * 0.001);
      gl.uniform2f(resolutionUniform, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animationId = requestAnimationFrame(render);
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    resize();
    window.addEventListener('resize', resize);
    animationId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [position]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute ${position === 'top' ? 'top-0' : 'bottom-0'} left-0 w-full ${position === 'top' ? 'h-[70vh]' : 'h-96'} pointer-events-none`}
      style={{ zIndex: 0, opacity: position === 'top' ? 0.4 : 1 }}
      aria-hidden
    />
  );
}
