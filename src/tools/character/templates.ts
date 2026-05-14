/**
 * Template resolver for class/feat description strings.
 *
 * Phase 1 of the character.ts refactor — see docs/character-refactor.md.
 *
 * D&D Beyond descriptions embed templates like `{{proficiency}}`,
 * `{{characterlevel*2#signed}}`, `{{level/3}}`. This factory takes the
 * character's profBonus and totalLevel and returns a resolver that
 * substitutes them.
 *
 * Supported variables:
 *   proficiency     — the character's proficiency bonus
 *   level           — total character level
 *   characterlevel  — alias of `level`
 *   classlevel      — `classLevel` arg, falls back to `totalLevel`
 *
 * Supported operators: `*`, `+`, `-`, `/` (integer divide).
 * Supported modifiers (after `#`): `signed`, `unsigned`.
 */

export type TemplateResolver = (text: string, classLevel?: number) => string;

export function makeResolveTemplates(profBonus: number, totalLevel: number): TemplateResolver {
  return (text: string, classLevel?: number): string => {
    const vars: Record<string, number> = {
      proficiency: profBonus,
      level: totalLevel,
      characterlevel: totalLevel,
      classlevel: classLevel ?? totalLevel,
    };
    return text.replace(/\{\{([^}]+)\}\}/g, (_match, expr: string) => {
      const [rawExpr, modifier] = expr.split("#") as [string, string | undefined];
      const opMatch = rawExpr.match(/^(\w+)\s*([*+\-/])\s*(\d+(?:\.\d+)?)$/);
      let value: number | null = null;
      if (opMatch) {
        const [, varName, op, numStr] = opMatch;
        const base = vars[varName] ?? null;
        const n = parseFloat(numStr);
        if (base !== null) {
          if (op === "*") value = base * n;
          else if (op === "+") value = base + n;
          else if (op === "-") value = base - n;
          else if (op === "/") value = Math.floor(base / n);
        }
      } else if (vars[rawExpr] !== undefined) {
        value = vars[rawExpr];
      }
      if (value === null) return "?";
      const rounded = Math.floor(value);
      if (modifier === "signed") return rounded >= 0 ? `+${rounded}` : `${rounded}`;
      if (modifier === "unsigned") return String(Math.max(0, rounded));
      return String(rounded);
    });
  };
}
