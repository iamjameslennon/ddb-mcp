/**
 * Template resolver for class/feat description strings.
 *
 * D&D Beyond descriptions embed templates like `{{proficiency}}`,
 * `{{characterlevel*2#signed}}`, `{{(classlevel/2)@roundup}}`,
 * `{{modifier:cha@min:1#unsigned}}`, `{{savedc:wis}}`.
 *
 * Grammar (whitespace ignored; `#signed` / `#unsigned` is split off first):
 *   expr    := term (('+'|'-') term)*
 *   term    := factor (('*'|'/') factor)*
 *   factor  := (number | var | '(' expr ')') postfix*
 *   postfix := '@min:' number | '@max:' number | '@roundup' | '@rounddown'
 *
 * Variables: proficiency, level, characterlevel, classlevel, and the
 * ability forms modifier:<abbr>, savedc:<abbr> (8 + proficiency + modifier),
 * spellattack:<abbr> (proficiency + modifier), abilityscore:<abbr>, where
 * <abbr> is str, dex, con, int, wis or cha. Division is exact. The final value
 * is floored, then formatted. Anything unparseable or unknown gives "?".
 */

export type TemplateResolver = (text: string, classLevel?: number) => string;

export interface TemplateContext {
  profBonus: number;
  totalLevel: number;
  /** Indexed str=0 ... cha=5. */
  statMods: readonly number[];
  statTotals: readonly number[];
}

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const ABILITY_NAMES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"] as const;

class TemplateError extends Error {}

function lookupVar(name: string, ctx: TemplateContext, classLevel: number): number {
  switch (name) {
    case "proficiency": return ctx.profBonus;
    case "level":
    case "characterlevel": return ctx.totalLevel;
    case "classlevel": return classLevel;
  }
  const m = name.match(/^(modifier|savedc|spellattack|abilityscore):([a-z]{3})$/);
  if (m) {
    const i = ABILITIES.indexOf(m[2] as typeof ABILITIES[number]);
    const mod = ctx.statMods[i];
    const total = ctx.statTotals[i];
    if (i >= 0 && mod !== undefined && total !== undefined) {
      if (m[1] === "modifier") return mod;
      if (m[1] === "savedc") return 8 + ctx.profBonus + mod;
      if (m[1] === "spellattack") return ctx.profBonus + mod;
      return total;
    }
  }
  throw new TemplateError(name);
}

function evaluate(src: string, ctx: TemplateContext, classLevel: number): number {
  const s = src.replace(/\s+/g, "");
  let pos = 0;
  const peek = () => s[pos];

  function number(): number {
    const m = s.slice(pos).match(/^\d+(?:\.\d+)?/);
    if (!m) throw new TemplateError("number");
    pos += m[0].length;
    return parseFloat(m[0]);
  }

  function factor(): number {
    let v: number;
    const c = peek();
    if (c === "(") {
      pos++;
      v = expr();
      if (peek() !== ")") throw new TemplateError(")");
      pos++;
    } else if (c !== undefined && /\d/.test(c)) {
      v = number();
    } else {
      const m = s.slice(pos).match(/^[a-z]+(?::[a-z]+)?/);
      if (!m) throw new TemplateError("factor");
      pos += m[0].length;
      v = lookupVar(m[0], ctx, classLevel);
    }
    while (peek() === "@") {
      const m = s.slice(pos).match(/^@(min|max|roundup|rounddown)/);
      if (!m) throw new TemplateError("postfix");
      pos += m[0].length;
      if (m[1] === "roundup") v = Math.ceil(v);
      else if (m[1] === "rounddown") v = Math.floor(v);
      else {
        if (peek() !== ":") throw new TemplateError(":");
        pos++;
        const n = number();
        v = m[1] === "min" ? Math.max(v, n) : Math.min(v, n);
      }
    }
    return v;
  }

  function term(): number {
    let v = factor();
    while (peek() === "*" || peek() === "/") {
      const op = s[pos++];
      const r = factor();
      if (op === "*") v *= r;
      else {
        if (r === 0) throw new TemplateError("div0");
        v /= r;
      }
    }
    return v;
  }

  function expr(): number {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = s[pos++];
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  const v = expr();
  if (pos !== s.length) throw new TemplateError("trailing");
  return v;
}

export function makeResolveTemplates(ctx: TemplateContext): TemplateResolver {
  return (text: string, classLevel?: number): string =>
    text.replace(/\{\{([^}]+)\}\}/g, (_match, body: string) => {
      const [rawExpr, modifier] = body.split("#") as [string, string | undefined];
      let value: number;
      try {
        value = Math.floor(evaluate(rawExpr, ctx, classLevel ?? ctx.totalLevel));
      } catch (e) {
        if (e instanceof TemplateError) return "?";
        throw e;
      }
      if (!Number.isFinite(value)) return "?";
      if (modifier === "signed") return value >= 0 ? `+${value}` : `${value}`;
      if (modifier === "unsigned") return String(Math.max(0, value));
      return String(value);
    });
}

function phraseFor(name: string): string | null {
  switch (name) {
    case "proficiency": return "your Proficiency Bonus";
    case "level":
    case "characterlevel": return "your character level";
    case "classlevel": return "your class level";
  }
  const m = name.match(/^(modifier|savedc|spellattack|abilityscore):([a-z]{3})$/);
  if (!m) return null;
  const i = ABILITIES.indexOf(m[2] as typeof ABILITIES[number]);
  if (i < 0) return null;
  const ab = ABILITY_NAMES[i];
  if (m[1] === "modifier") return `your ${ab} modifier`;
  if (m[1] === "savedc") return `your ${ab} save DC`;
  if (m[1] === "spellattack") return `your ${ab} spell attack bonus`;
  return `your ${ab} score`;
}

const VAR = "[a-z]+(?::[a-z]+)?";

/** Catalog text has no character: turn templates into a plain-English phrase. */
export function describeTemplates(text: string): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_match, body: string) => {
    const expr = body.split("#")[0].replace(/\s+/g, "");
    const fallback = "a value based on your character";
    if (new RegExp(`^${VAR}$`).test(expr)) return phraseFor(expr) ?? fallback;
    const m = expr.match(new RegExp(`^(?:(\\d+)\\*(${VAR})|(${VAR})\\*(\\d+))$`));
    if (m) {
      const n = m[1] ?? m[4];
      const phrase = phraseFor(m[2] ?? m[3]);
      if (phrase) return n === "2" ? `twice ${phrase}` : `${n} × ${phrase}`;
    }
    return fallback;
  });
}
