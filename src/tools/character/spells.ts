/**
 * Spells domain — spellcasting stats, spell slots, the prepared/known spell
 * listing (with cross-source duplicate detection), and the concentration
 * block. Owns the SPELLS block and the CONCENTRATION SPELLS block.
 *
 * Phase 7 of the character.ts refactor — see docs/character-refactor.md.
 *
 * Concentration detection delegates to `isConcentrationSpell` in
 * `../reference.ts`: the spell's own `concentration` flag first, then the same
 * definition id, then the twin group's entry for its own edition. Spellbook (Wizard) prepared/ritual gate is applied
 * to leveled spells but not cantrips.
 *
 * Output is pre-formatted strings to preserve byte-for-byte parity with
 * the original inline code.
 */

import { isConcentrationSpell } from "../reference.js";
import { wrapIfHomebrew } from "../../utils.js";
import { arr, isHomebrewEntry, num, obj, shownHomebrew, signed, splitListLines, statNames, str } from "./helpers.js";
import type { CharData, ClassEntry, CoreStats, ListEntry } from "./types.js";
import type { CharacterEditions } from "./editions.js";

export interface Spells {
  spellcastingLines: string[];                  // "  Wizard: INT  Spell Attack: +5  Save DC: 13"
  slotLines: string[];                          // "  Level 1: 4/4"
  spellSections: string[];                      // "  Cantrips: ...", "  Spells: ...", "  From Racial Trait: ...", duplicate warnings; homebrew entries on wrapped "(homebrew)" lines
  concentrationByLevel: Map<number, ListEntry[]>;  // level → ordered spell names, each flagged homebrew or not
}

const SOURCE_LABELS: Record<string, string> = {
  race: "Racial Trait", class: "Class Feature", background: "Background", feat: "Feat", item: "Item",
};

const SLOT_ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
const slotOrdinal = (lvl: number): string => SLOT_ORDINAL[lvl] ?? `${lvl}th`;

// ── Spellcasting summary (per spellcasting class) ────────────────────────────
function buildSpellcastingLines(
  classes: readonly ClassEntry[],
  statMods: readonly number[],
  profBonus: number,
): string[] {
  // spellCastingAbilityId: 1=STR 2=DEX 3=CON 4=INT 5=WIS 6=CHA
  const lines: string[] = [];
  for (const c of classes) {
    const def = obj(c.definition);
    const subDef = obj(c.subclassDefinition);
    const classCasts = def.canCastSpells === true;
    const subclassCasts = subDef.canCastSpells === true;
    if (!classCasts && !subclassCasts) continue;
    const abilityId = num(classCasts ? def.spellCastingAbilityId : subDef.spellCastingAbilityId);
    if (!abilityId) continue;
    const className = classCasts ? str(def.name) : `${str(def.name)} (${str(subDef.name)})`;
    const abilityMod = statMods[abilityId - 1];
    const spellAttack = abilityMod + profBonus;
    const saveDc = 8 + abilityMod + profBonus;
    lines.push(
      `  ${className}: ${statNames[abilityId - 1]}  Spell Attack: ${signed(spellAttack)}  Save DC: ${saveDc}`
    );
  }
  return lines;
}

// ── Spell slots (max from levelSpellSlots, used from char.spellSlots) ────────
function buildSlotLines(char: CharData, classes: readonly ClassEntry[]): string[] {
  // char.spellSlots only tracks used counts; max slots come from the class's
  // levelSpellSlots progression table: levelSpellSlots[classLevel][slotLevel-1]
  const spellSlotUsed: Record<number, number> = {};
  for (const s of arr<Record<string, unknown>>(char.spellSlots)) {
    spellSlotUsed[num(s.level)] = num(s.used);
  }
  const slotMax: Record<number, number> = {};
  for (const c of classes) {
    // Only compute slots for classes/subclasses that actually grant spellcasting.
    // Non-spellcasting base classes (Barbarian, Rogue, Monk, etc.) have canCastSpells: false
    // but still carry non-empty levelSpellSlots tables — skip those.
    // Spellcasting subclasses (Arcane Trickster, Eldritch Knight) set canCastSpells on
    // the subclassDefinition instead, so check both.
    const classCasts = obj(c.definition).canCastSpells === true;
    const subclassCasts = obj(c.subclassDefinition).canCastSpells === true;
    if (!classCasts && !subclassCasts) continue;
    const spellRules = obj(obj(c.definition).spellRules);
    const rawTable = spellRules.levelSpellSlots;
    const table: number[][] = Array.isArray(rawTable) ? rawTable as number[][] : [];
    const lvl = num(c.level);
    const row = table[lvl] ?? [];
    for (let i = 0; i < row.length; i++) {
      if (row[i] > 0) slotMax[i + 1] = (slotMax[i + 1] ?? 0) + row[i];
    }
  }
  return Object.entries(slotMax)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([lvl, max]) => {
      const used = spellSlotUsed[Number(lvl)] ?? 0;
      return `  Level ${lvl}: ${max - used}/${max}`;
    });
}

// ── Class spell lists ────────────────────────────────────────────────────────
export interface ClassSpellList {
  className: string;
  isSpellbook: boolean;
  spells: Record<string, unknown>[];
}

// Each char.classSpells entry with its class's name. Ungated: callers apply the
// spellbook gate (isShownClassSpell) themselves.
export function classSpellLists(char: CharData, classes: readonly ClassEntry[]): ClassSpellList[] {
  return arr<Record<string, unknown>>(char.classSpells).map(cs => {
    // Try characterClassId first; fall back to id/classId for 2024-rules format
    const classEntry = classes.find(c =>
      c.id === cs.characterClassId ||
      c.id === cs.id ||
      c.id === cs.classId
    );
    const className = str(obj(classEntry?.definition ?? {}).name);
    // spells may be under cs.spells or cs.classSpells (2024 format variation)
    const spells = arr<Record<string, unknown>>(cs.spells).length > 0
      ? arr<Record<string, unknown>>(cs.spells)
      : arr<Record<string, unknown>>(cs.classSpells);
    return { className, isSpellbook: className === "Wizard", spells };
  });
}

// Spellbook (Wizard) gate: a leveled spell shows only when prepared or a
// ritual; cantrips always show.
export function isShownClassSpell(s: Record<string, unknown>, isSpellbook: boolean): boolean {
  const def = obj(s.definition);
  if (num(def.level) === 0 || !isSpellbook) return true;
  return s.prepared === true || def.ritual === true;
}

/**
 * The definitions of every spell the SPELLS section lists: gated class spells,
 * then each SOURCE_LABELS list in order. Not deduped.
 */
export function shownSpellDefinitions(char: CharData, classes: readonly ClassEntry[]): Record<string, unknown>[] {
  const defs: Record<string, unknown>[] = [];
  for (const { isSpellbook, spells } of classSpellLists(char, classes)) {
    for (const s of spells) if (isShownClassSpell(s, isSpellbook)) defs.push(obj(s.definition));
  }
  const spellsObj = obj(char.spells);
  for (const key of Object.keys(SOURCE_LABELS)) {
    for (const s of arr<Record<string, unknown>>(spellsObj[key])) {
      // buildSpellSections drops a nameless spell from "From X:", so it isn't shown.
      if (str(obj(s.definition).name)) defs.push(obj(s.definition));
    }
  }
  return defs;
}

// ── Spell listing (per class + per non-class source + duplicate warnings) ────
// Pre-seeds seenSpellIds during the per-class walk so duplicate detection
// across sources is consistent regardless of section order.
function buildSpellSections(
  char: CharData,
  classes: readonly ClassEntry[],
  editions: CharacterEditions,
): string[] {
  const sections: string[] = [];
  const seenSpellIds = new Map<number, string>(); // spellId → first source label

  for (const { isSpellbook, spells: allSpells } of classSpellLists(char, classes)) {
    const cantrips = allSpells
      .filter(s => num(obj(s.definition).level) === 0)
      .map(s => {
        const name = editions.named(str(obj(s.definition).name), s.definition);
        return { text: name, homebrew: shownHomebrew(s, name) };
      });
    const leveled = allSpells
      .filter(s => num(obj(s.definition).level) > 0 && isShownClassSpell(s, isSpellbook))
      .map(s => {
        const def = obj(s.definition);
        const ritual = isSpellbook && def.ritual ? " [ritual]" : "";
        const name = editions.named(str(def.name), def);
        return { text: `${name} (L${num(def.level)}${ritual})`, homebrew: shownHomebrew(s, name) };
      });
    // Homebrew spells are other players' text: they leave the list for a wrapped line below it.
    sections.push(...splitListLines("  ", "Cantrips", cantrips), ...splitListLines("  ", "Spells", leveled));
    // Pre-seed duplicate detection in the same pass, from the gated list the
    // section prints: an unprepared spellbook spell is not shown, so it can't
    // be "already granted".
    for (const s of allSpells) {
      if (!isShownClassSpell(s, isSpellbook)) continue;
      const spellId = num(obj(s.definition).id);
      // The label names the line the spell prints on: cantrips have their own.
      if (spellId && !seenSpellIds.has(spellId)) seenSpellIds.set(spellId, num(obj(s.definition).level) === 0 ? "Cantrips" : "Spells");
    }
  }

  const spellsObj = obj(char.spells);
  const duplicateWarnings: string[] = [];

  for (const [key, label] of Object.entries(SOURCE_LABELS)) {
    const spellList = arr<Record<string, unknown>>(spellsObj[key]);
    if (!spellList.length) continue;
    const seen = new Set<string>();
    const names = spellList
        .filter(s => {
          const def = obj(s.definition);
          const spellId = num(def.id);
          if (!spellId) return true;
          if (seenSpellIds.has(spellId)) {
            const firstLabel = seenSpellIds.get(spellId)!;
            const spellName = editions.named(str(def.name), def);
            const lvl = num(def.level);
            const spellStr = lvl === 0 ? spellName : `${spellName} (L${lvl})`;
            duplicateWarnings.push(wrapIfHomebrew(`  • ${spellStr} — already granted by ${firstLabel}, also in ${label}`, shownHomebrew(s, spellName)));
            return false;
          }
          seenSpellIds.set(spellId, label);
          return true;
        })
        .map(s => {
          const def = obj(s.definition);
          const n = editions.named(str(def.name), def);
          return { text: n ? (num(def.level) === 0 ? n : `${n} (L${num(def.level)})`) : "", homebrew: shownHomebrew(s, n) };
        })
        // Nameless entries are dropped; duplicates by text within the official and the homebrew entries.
        .filter(e => {
          const key = `${e.homebrew}:${e.text}`;
          if (!e.text || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    sections.push(...splitListLines("  ", `From ${label}`, names));
  }

  if (duplicateWarnings.length) {
    sections.push(
      `  ⚠ Duplicate spell grants detected — the following spells are already`,
      `  provided by an earlier source; the extra grant may be a wasted choice:`,
      ...duplicateWarnings
    );
  }

  return sections;
}

// ── Concentration spell collection ───────────────────────────────────────────
// Collects all available/prepared spells, filters to concentration:true,
// groups by spell level. Spellbook gate is applied to leveled spells but
// not cantrips (cantrips don't go through prepared/known lists).
function buildConcentrationByLevel(
  char: CharData,
  classes: readonly ClassEntry[],
  editions: CharacterEditions,
): Map<number, ListEntry[]> {
  const concByLevel = new Map<number, ListEntry[]>();
  const addConcSpell = (s: Record<string, unknown>) => {
    const def = obj(s.definition);
    if (!str(def.name)) return;
    const text = editions.named(str(def.name), def);
    const homebrew = isHomebrewEntry(s);
    const level = num(def.level);
    const isConc = isConcentrationSpell(def) ?? false;
    if (!isConc) return;
    const bucket = concByLevel.get(level) ?? [];
    if (!bucket.some(e => e.text === text && e.homebrew === homebrew)) { bucket.push({ text, homebrew }); concByLevel.set(level, bucket); }
  };
  for (const { isSpellbook, spells } of classSpellLists(char, classes)) {
    for (const s of spells) if (isShownClassSpell(s, isSpellbook)) addConcSpell(s);
  }
  for (const spellList of Object.values(obj(char.spells))) {
    for (const s of arr<Record<string, unknown>>(spellList)) addConcSpell(s);
  }
  return concByLevel;
}

// ── Public API ───────────────────────────────────────────────────────────────
export function computeSpells(core: CoreStats): Spells {
  const { char, classes, statMods, profBonus, editions } = core;
  return {
    spellcastingLines: buildSpellcastingLines(classes, statMods, profBonus),
    slotLines: buildSlotLines(char, classes),
    spellSections: buildSpellSections(char, classes, editions),
    concentrationByLevel: buildConcentrationByLevel(char, classes, editions),
  };
}

export function formatSpellsBlock(s: Spells): string[] {
  return [
    ...(s.spellcastingLines.length ? [`SPELLCASTING`, ...s.spellcastingLines, ``] : []),
    ...(s.slotLines.length ? [`SPELL SLOTS`, ...s.slotLines, ``] : []),
    ...(s.spellSections.length ? [`SPELLS`, ...s.spellSections, ``] : []),
  ];
}

export function formatConcentrationBlock(s: Spells): string[] {
  if (s.concentrationByLevel.size === 0) {
    return ["This character has no concentration spells prepared."];
  }
  const out: string[] = ["CONCENTRATION SPELLS"];
  for (const lvl of [...s.concentrationByLevel.keys()].sort((a, b) => a - b)) {
    out.push(lvl === 0 ? "  Cantrips (no slot required):" : `  Level ${lvl}:`);
    for (const { text, homebrew } of s.concentrationByLevel.get(lvl)!) {
      out.push(wrapIfHomebrew(`    • ${text}${lvl > 0 ? ` [${slotOrdinal(lvl)}-level slot]` : ""}`, homebrew));
    }
  }
  out.push("");
  if (s.slotLines.length) out.push("SPELL SLOTS", ...s.slotLines);
  return out;
}
