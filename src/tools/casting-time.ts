/**
 * Spell casting time from D&D Beyond's `activation` and `castingTimeDescription`.
 *
 * `activationType` (confirmed live on character 112316571):
 *
 * | type | label        | prints                                              |
 * |------|--------------|-----------------------------------------------------|
 * | 1    | Action       | `N Action(s)`                                       |
 * | 2    | No Action    | `No Action` (no number)                             |
 * | 3    | Bonus Action | `N Bonus Action(s)`                                 |
 * | 4    | Reaction     | `N Reaction(s)`, then `, <castingTimeDescription>`  |
 * | 5, 8 | Special      | `Special` (no number)                               |
 * | 6    | Minute       | `N Minute(s)`                                       |
 * | 7    | Hour         | `N Hour(s)`                                         |
 * | else | —            | `N (activation type T)`                             |
 *
 * The label is plural when N is not 1. A missing, zero or non-finite N counts
 * as 1, and an absent `activation` reads "1 Action".
 */
const LABELS: Record<number, string> = {
  1: "Action", 3: "Bonus Action", 4: "Reaction", 6: "Minute", 7: "Hour",
};

export function castingTimeText(
  activation: { activationTime?: unknown; activationType?: unknown } | null | undefined,
  castingTimeDescription?: unknown,
): string {
  if (!activation) return "1 Action";
  const type = Number(activation.activationType);
  if (type === 2) return "No Action";
  if (type === 5 || type === 8) return "Special";
  const raw = Number(activation.activationTime);
  const n = Number.isFinite(raw) && raw !== 0 ? raw : 1;
  const label = LABELS[type];
  if (!label) return `${n} (activation type ${activation.activationType})`;
  let text = `${n} ${label}${n === 1 ? "" : "s"}`;
  if (type === 4 && typeof castingTimeDescription === "string" && castingTimeDescription.trim()) {
    text += `, ${castingTimeDescription.trim()}`;
  }
  return text;
}
