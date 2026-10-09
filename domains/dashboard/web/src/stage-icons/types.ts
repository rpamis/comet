import type { CSSProperties } from 'react';

export const STAGES = ['launch', 'design', 'build', 'verify', 'archive'] as const;
export const STATUSES = ['idle', 'running', 'waiting', 'success', 'error', 'blocked'] as const;
export type Stage = (typeof STAGES)[number];
export type StageStatus = (typeof STATUSES)[number];

export interface StageIconProps {
  stage: Stage;
  status?: StageStatus;
  size?: number | string;
  className?: string;
  style?: CSSProperties;
  /** Optional accessible name. Use decorative=true when adjacent text labels the icon. */
  label?: string;
  decorative?: boolean;
  /** true disables all movement. OS reduced-motion is always respected. */
  reducedMotion?: boolean;
  /** Surface color used by the status badge's separation outline. */
  surfaceColor?: string;
}
