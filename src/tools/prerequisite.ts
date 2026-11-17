/**
 * Feat prerequisite matching, shared by the D&D Beyond and Open5e feat searches.
 * Prerequisites are free text ("Level 4+; Strength or Dexterity 13+", "Str or Dex 13+"),
 * so a plain substring test misses "strength 13" against both.
 */

const ABILITIES: Record<string, string> = {
  str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma",
};

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(t => ABILITIES[t] ?? t);
}

/**
 * True when every word of the query is among the prerequisite's words (any order,
 * ability abbreviations expanded), or when the prerequisite contains the query as a
 * substring (partial words such as "spell"). An empty query matches; an empty or null
 * prerequisite never matches a non-empty query.
 */
export function prerequisiteMatches(prerequisite: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const p = (prerequisite ?? "").toLowerCase();
  if (!p) return false;
  if (p.includes(q)) return true;
  const have = new Set(tokens(p));
  const want = tokens(q);
  return want.length > 0 && want.every(t => have.has(t));
}

/** One group of D&D Beyond's `prerequisites` array: groups are alternatives (an OR list). */
export interface DdbPrerequisite {
  description?: string | null;
  hidePrerequisite?: boolean;
  prerequisiteMappings?: Array<{
    type?: string | null;
    subType?: string | null;
    value?: number | null;
    friendlySubTypeName?: string | null;
  }> | null;
}

type Groups = readonly DdbPrerequisite[] | null | undefined;

function mappingsOf(g: DdbPrerequisite) {
  return g.prerequisiteMappings ?? [];
}

function classFeatureSummary(g: DdbPrerequisite): string {
  const sub = (mappingsOf(g)[0]?.subType ?? "").toLowerCase();
  if (sub.includes("fighting-style")) return "a Fighting Style feature";
  if (sub.includes("spellcasting") || sub.includes("pact-magic")) return "the Spellcasting or Pact Magic feature";
  return (g.description ?? "").trim();
}

/**
 * The displayed prerequisite text of a feat's `prerequisites` groups. Groups flagged
 * `hidePrerequisite` are left out. When every shown group has mappings and all of them are
 * `class-feature`, the distinct summaries ("a Fighting Style feature") are joined with " or ";
 * otherwise the distinct descriptions are, a continuation ("or Dexterity 13+") joined with a space.
 */
export function ddbPrerequisiteText(prereqs: Groups): string {
  const shown = (prereqs ?? []).filter(g => g.hidePrerequisite !== true);
  if (shown.length === 0) return "";
  const allClassFeature = shown.every(g => mappingsOf(g).length > 0 && mappingsOf(g).every(m => m.type === "class-feature"));
  const parts = [...new Set(shown.map(g => allClassFeature ? classFeatureSummary(g) : (g.description ?? "").trim()).filter(Boolean))];
  if (allClassFeature) return parts.join(" or ");
  return parts.reduce((out, p) => out ? out + (/^or\s/i.test(p) ? " " : "; ") + p : p, "");
}

function ddbGroupText(g: DdbPrerequisite): string {
  const mapped = mappingsOf(g).map(m => {
    const name = m.friendlySubTypeName ?? m.subType ?? "";
    if (m.type === "ability-score") return `${name} ${m.value ?? ""}`.trim();
    if (m.type === "level") return `level ${m.value ?? ""}`.trim();
    return m.friendlySubTypeName ?? "";
  });
  return [(g.description ?? "").trim(), ...mapped].filter(Boolean).join("; ");
}

/**
 * True when the query matches any one group (word matching per group, mapping phrases
 * included, hidden groups too), or is a case-insensitive substring of the displayed text.
 * A query cannot combine words from two OR alternatives. An empty query matches.
 */
export function ddbPrerequisiteMatches(prereqs: Groups, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (ddbPrerequisiteText(prereqs).toLowerCase().includes(q)) return true;
  return (prereqs ?? []).some(g => prerequisiteMatches(ddbGroupText(g), query));
}
