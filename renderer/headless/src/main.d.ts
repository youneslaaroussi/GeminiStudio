import { type Project as MotionCanvasProject } from '@motion-canvas/core';
declare global {
    interface Window {
        nodeHandleRenderProgress?: (frame: number, total: number) => void;
        nodeHandleRenderEnd?: (status: string) => void;
        nodeHandleRenderError?: (message: string) => void;
        __SCENE_PROJECT__?: MotionCanvasProject;
    }
}
