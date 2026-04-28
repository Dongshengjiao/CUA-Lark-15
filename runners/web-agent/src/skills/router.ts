// M5 task 1.2: keyword-based skill router.
//
// Pure function. Takes the user prompt and the registered skill array
// (order = priority), returns the first skill whose matchKeywords have
// a substring match. No NLP, no embedding, no VLM dispatch — see
// m5-feishu-skills/design.md §D2 for the rationale.

import type { Skill } from './types.js';

export function selectSkill(prompt: string, registry: readonly Skill[]): Skill | null {
  const lower = prompt.toLowerCase();
  for (const skill of registry) {
    if (skill.matchKeywords.some((k) => lower.includes(k.toLowerCase()))) {
      return skill;
    }
  }
  return null;
}
