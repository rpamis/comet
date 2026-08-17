import { reviewMemoryPacket } from './semantic-review.js';
import type {
  MemoryReviewActionSet,
  MemoryReviewPacket,
  MemoryReviewSkillRunner,
} from './types.js';

/**
 * Runtime boundary for the first-party comet-memory Skill.
 *
 * Hosts that can invoke installed Skills provide `runner`. The bounded local
 * adapter keeps CLI/Classic/Native usable when a host cannot fork an Agent;
 * it is intentionally behind this boundary so the plugin never embeds the
 * Skill's decision procedure in its event wiring.
 */
export async function invokeMemoryReviewSkill(
  packet: MemoryReviewPacket,
  runner?: MemoryReviewSkillRunner,
): Promise<MemoryReviewActionSet> {
  return runner === undefined ? reviewMemoryPacket(packet) : runner(packet);
}
