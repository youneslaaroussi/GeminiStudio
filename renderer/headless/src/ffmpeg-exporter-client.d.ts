import type { Project, RendererResult, RendererSettings } from '@motion-canvas/core';
declare class MetaField<T> {
    readonly name: string;
    readonly initial: T;
    constructor(name: string, initial: T);
}
interface Exporter {
    start?(): Promise<void>;
    handleFrame(canvas: HTMLCanvasElement): Promise<void>;
    stop?(result: RendererResult): Promise<void>;
}
export declare class FFmpegExporterClient implements Exporter {
    private readonly project;
    private readonly settings;
    static readonly id = "@motion-canvas/ffmpeg-custom";
    static readonly displayName = "FFmpeg (Gemini Studio)";
    static meta(): MetaField<unknown>;
    static create(project: Project, settings: RendererSettings): Promise<FFmpegExporterClient>;
    private readonly pending;
    private readonly socket;
    private frameIndex;
    constructor(project: Project, settings: RendererSettings);
    private handleAck;
    private invoke;
    start(): Promise<void>;
    handleFrame(canvas: HTMLCanvasElement): Promise<void>;
    stop(result: RendererResult): Promise<void>;
}
export {};
