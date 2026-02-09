import { getSocket } from './socket.js';
class MetaField {
    name;
    initial;
    constructor(name, initial) {
        this.name = name;
        this.initial = initial;
    }
}
export class FFmpegExporterClient {
    project;
    settings;
    static id = '@motion-canvas/ffmpeg-custom';
    static displayName = 'FFmpeg (Gemini Studio)';
    static meta() {
        return new MetaField('ffmpeg', null);
    }
    static async create(project, settings) {
        return new FFmpegExporterClient(project, settings);
    }
    pending = new Map();
    socket = getSocket();
    frameIndex = 0;
    constructor(project, settings) {
        this.project = project;
        this.settings = settings;
        this.socket.on('motion-canvas/ffmpeg-ack', this.handleAck);
    }
    handleAck = (response) => {
        const queue = this.pending.get(response.method);
        if (!queue || queue.length === 0) {
            return;
        }
        const { resolve, reject } = queue.shift();
        if (queue.length === 0) {
            this.pending.delete(response.method);
        }
        if (response.status === 'success') {
            resolve(response.data);
        }
        else {
            reject(new Error(response.message ?? 'FFmpeg exporter error'));
        }
    };
    invoke(method, data) {
        return new Promise((resolve, reject) => {
            const queue = this.pending.get(method) ?? [];
            queue.push({ resolve, reject });
            this.pending.set(method, queue);
            this.socket.emit('motion-canvas/ffmpeg', { method, data });
        });
    }
    async start() {
        this.frameIndex = 0;
        const options = this.settings.exporter.options;
        const audioOffset = this.project.meta?.shared?.audioOffset?.get?.() ?? 0;
        await this.invoke('start', {
            ...this.settings,
            ...options,
            audio: this.project.audio,
            audioOffset: audioOffset - this.settings.range[0],
        });
    }
    async handleFrame(canvas) {
        const totalFrames = Math.round(Math.max(0, this.settings.range[1] - this.settings.range[0]) * this.settings.fps);
        // Drop last frame (Motion Canvas often renders a black frame at the end).
        if (this.frameIndex >= totalFrames - 1) {
            this.frameIndex++;
            return;
        }
        const blob = await new Promise((resolve) => canvas.toBlob((result) => resolve(result), 'image/png'));
        if (!blob) {
            this.frameIndex++;
            return;
        }
        const buffer = await blob.arrayBuffer();
        await this.invoke('handleFrame', { data: buffer });
        this.frameIndex++;
    }
    async stop(result) {
        try {
            await this.invoke('end', result);
        }
        finally {
            this.socket.off('motion-canvas/ffmpeg-ack', this.handleAck);
            this.pending.clear();
        }
    }
}
//# sourceMappingURL=ffmpeg-exporter-client.js.map