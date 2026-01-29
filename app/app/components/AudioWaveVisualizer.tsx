"use client";

import { useRef, useEffect, useCallback } from "react";

interface AudioWaveVisualizerProps {
  /** Audio level from 0-1 */
  level: number;
  /** Whether the AI is currently speaking */
  isActive: boolean;
  /** Primary color (CSS color string) */
  color?: string;
  /** Applied to the wrapper so the canvas fills the container */
  className?: string;
}

const VERTEX_SHADER = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  
  uniform float u_time;
  uniform float u_level;
  uniform float u_active;
  uniform vec2 u_resolution;
  uniform vec3 u_color;
  
  // Simplex noise function
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
  
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m;
    m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  
  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    
    // Multiple wave layers
    float baseSpeed = 0.5 + u_level * 2.0;
    float waveHeight = 0.15 + u_level * 0.35;
    
    // Layer 1 - slow base wave
    float wave1 = snoise(vec2(uv.x * 3.0 + u_time * baseSpeed * 0.3, u_time * 0.2)) * waveHeight;
    
    // Layer 2 - medium wave
    float wave2 = snoise(vec2(uv.x * 5.0 - u_time * baseSpeed * 0.5, u_time * 0.3 + 10.0)) * waveHeight * 0.7;
    
    // Layer 3 - fast detail wave
    float wave3 = snoise(vec2(uv.x * 8.0 + u_time * baseSpeed * 0.8, u_time * 0.4 + 20.0)) * waveHeight * 0.4;
    
    // Combine waves
    float combinedWave = wave1 + wave2 + wave3;
    
    // Wave threshold from bottom
    float waveThreshold = combinedWave + 0.3;
    
    // Calculate distance from wave edge for glow
    float dist = uv.y - waveThreshold;
    
    // Base alpha with soft edge
    float alpha = smoothstep(0.15, 0.0, dist);
    
    // Add glow effect
    float glow = exp(-dist * 8.0) * 0.5 * u_level;
    alpha += glow;
    
    // Fade when not active
    alpha *= 0.3 + u_active * 0.7;
    
    // Add subtle gradient
    float gradient = 1.0 - uv.y * 0.5;
    
    // Final color with translucency
    vec3 finalColor = u_color * gradient;
    
    // Add highlight at wave crest
    float crestHighlight = smoothstep(0.02, 0.0, abs(dist)) * u_level * 0.5;
    finalColor += vec3(1.0) * crestHighlight;
    
    gl_FragColor = vec4(finalColor, alpha * 0.8);
  }
`;

function hexToRgb(hex: string): [number, number, number] {
  // Remove # if present
  hex = hex.replace(/^#/, "");
  
  // Parse hex values
  const bigint = parseInt(hex, 16);
  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;
  
  return [r, g, b];
}

export function AudioWaveVisualizer({
  level,
  isActive,
  color = "#3b82f6",
  className = "",
}: AudioWaveVisualizerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const animationRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const levelRef = useRef<number>(0);
  const activeRef = useRef<number>(0);

  // Smooth the level changes
  useEffect(() => {
    levelRef.current = levelRef.current * 0.8 + level * 0.2;
  }, [level]);

  useEffect(() => {
    activeRef.current = activeRef.current * 0.9 + (isActive ? 1 : 0) * 0.1;
  }, [isActive]);

  const initGL = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    });
    if (!gl) {
      console.warn("WebGL not supported");
      return;
    }

    glRef.current = gl;

    // Create shaders
    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vertexShader, VERTEX_SHADER);
    gl.compileShader(vertexShader);

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fragmentShader, FRAGMENT_SHADER);
    gl.compileShader(fragmentShader);

    // Check for shader errors
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      console.error("Fragment shader error:", gl.getShaderInfoLog(fragmentShader));
      return;
    }

    // Create program
    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program link error:", gl.getProgramInfoLog(program));
      return;
    }

    programRef.current = program;

    // Create full-screen quad
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    // Enable blending for transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    startTimeRef.current = Date.now();
  }, []);

  const render = useCallback(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const canvas = canvasRef.current;

    if (!gl || !program || !canvas) {
      animationRef.current = requestAnimationFrame(render);
      return;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);

    // Update uniforms
    const time = (Date.now() - startTimeRef.current) / 1000;
    gl.uniform1f(gl.getUniformLocation(program, "u_time"), time);
    gl.uniform1f(gl.getUniformLocation(program, "u_level"), levelRef.current);
    gl.uniform1f(gl.getUniformLocation(program, "u_active"), activeRef.current);
    gl.uniform2f(gl.getUniformLocation(program, "u_resolution"), canvas.width, canvas.height);
    
    const rgb = hexToRgb(color);
    gl.uniform3f(gl.getUniformLocation(program, "u_color"), rgb[0], rgb[1], rgb[2]);

    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    animationRef.current = requestAnimationFrame(render);
  }, [color]);

  useEffect(() => {
    initGL();
    animationRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [initGL, render]);

  // Update level smoothly
  useEffect(() => {
    levelRef.current = levelRef.current * 0.7 + level * 0.3;
  }, [level]);

  // Update active state smoothly
  useEffect(() => {
    activeRef.current = activeRef.current * 0.85 + (isActive ? 1 : 0) * 0.15;
  }, [isActive]);

  // Size canvas to fit container (width/height = drawing buffer; display via CSS)
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const setSize = () => {
      const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio ?? 1, 2) : 1;
      const w = wrapper.clientWidth;
      const h = wrapper.clientHeight;
      if (w <= 0 || h <= 0) return;
      const drawWidth = Math.round(w * dpr);
      const drawHeight = Math.round(h * dpr);
      if (canvas.width !== drawWidth || canvas.height !== drawHeight) {
        canvas.width = drawWidth;
        canvas.height = drawHeight;
      }
    };

    setSize();
    const ro = new ResizeObserver(setSize);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className={`w-full h-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        style={{ pointerEvents: "none" }}
      />
    </div>
  );
}
