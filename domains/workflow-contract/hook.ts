export interface CometHookDecision {
  allowed: boolean;
  reason: string;
  workflow?: 'native' | 'classic';
  change?: string;
  phase?: string;
  context?: string;
}
