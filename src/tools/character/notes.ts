/**
 * Notes domain — personality traits, backstory, allies/organisations, and
 * additional possessions/notes. Owns the notes block.
 *
 * Phase 8 of the character.ts refactor — see docs/character-refactor.md.
 *
 * Uses the full `stripHtml` from `../../utils.js` (which decodes HTML
 * entities) rather than the lightweight helpers version — backstory and
 * traits frequently contain entities like `&rsquo;` and `&mdash;`.
 */

import { stripHtml } from "../../utils.js";
import { obj, str } from "./helpers.js";
import type { CoreStats } from "./types.js";

export interface Notes {
  traitLines: string[];     // ["  Traits:      \"Honey, show me where it broke…\"", …]
  backstoryText: string | null;
  allyLines: string[];      // ["  Allies:        Acquisitions Incorporated", …]
  extraLines: string[];     // ["  Possessions: identification papers", …]
}

const field = (v: unknown): string | null => {
  const s = stripHtml(str(v)).trim();
  return s || null;
};

const labelled = (label: string, pad: number, v: unknown): string | null => {
  const t = field(v);
  return t ? `  ${label.padEnd(pad)}${t}` : null;
};

export function computeNotes(core: CoreStats): Notes {
  const { char } = core;
  const traits = obj(char.traits);
  const notes = obj(char.notes);

  const traitLines = [
    labelled("Traits:",     13, traits.personalityTraits),
    labelled("Ideals:",     13, traits.ideals),
    labelled("Bonds:",      13, traits.bonds),
    labelled("Flaws:",      13, traits.flaws),
    labelled("Appearance:", 13, traits.appearance),
  ].filter((l): l is string => l !== null);

  const allyLines = [
    labelled("Allies:",        15, notes.allies),
    labelled("Organisations:", 15, notes.organizations),
  ].filter((l): l is string => l !== null);

  const extraLines = [
    labelled("Possessions:", 13, notes.personalPossessions),
    labelled("Other:",       13, notes.otherNotes),
  ].filter((l): l is string => l !== null);

  return {
    traitLines,
    backstoryText: field(notes.backstory),
    allyLines,
    extraLines,
  };
}

export function formatNotesBlock(n: Notes): string[] {
  const hasAny = n.traitLines.length || n.backstoryText || n.allyLines.length || n.extraLines.length;
  if (!hasAny) {
    return ["No notes or backstory have been recorded for this character."];
  }
  const out: string[] = [];
  if (n.traitLines.length) out.push("PERSONALITY", ...n.traitLines, "");
  if (n.backstoryText)     out.push("BACKSTORY", `  ${n.backstoryText}`, "");
  if (n.allyLines.length)  out.push("ALLIES & ORGANISATIONS", ...n.allyLines, "");
  if (n.extraLines.length) out.push("ADDITIONAL NOTES", ...n.extraLines, "");
  return out;
}
