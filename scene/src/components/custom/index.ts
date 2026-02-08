import { registerComponent } from '../../lib/clips';

import { ProgressRing } from './ProgressRing';

registerComponent('ProgressRing', ProgressRing as unknown as new (props?: Record<string, unknown>) => import('@motion-canvas/2d').Node);
