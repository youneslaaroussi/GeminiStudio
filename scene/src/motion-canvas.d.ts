declare module '*?scene' {
  const value: import('@motion-canvas/core').FullSceneDescription;
  export default value;
}

declare module '*.glsl' {
  const source: string;
  export default source;
}
