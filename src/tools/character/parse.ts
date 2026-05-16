/**
 * `parseCharacterData(raw, sections)` — the orchestrator.
 *
 * Phase 9 of the character.ts refactor — see docs/character-refactor.md.
 *
 * Every domain (identity, vitals, ac, stats, defenses, features, actions,
 * spells, inventory, notes) computed once via `computeCoreStats`, then
 * routed through `sections` to pick which blocks to render. No business
 * logic lives here — only the section → block routing.
 */

import { addCharacterSpellsToCompendium } from "../reference.js";
import { computeCoreStats } from "./core.js";
import type { CharData, ParseSection } from "./types.js";
import { computeIdentity, formatHeaderBlock } from "./identity.js";
import { computeVitals, formatVitalsBlock } from "./vitals.js";
import { computeAc } from "./ac.js";
import { computeStats, formatStatsBlock } from "./stats.js";
import { computeDefenses, formatDefensesBlock } from "./defenses.js";
import { computeFeatures, formatFeaturesBlock } from "./features.js";
import { computeActions, formatCombatBlock } from "./actions.js";
import { computeSpells, formatSpellsBlock, formatConcentrationBlock } from "./spells.js";
import { computeInventory, formatInventoryBlock } from "./inventory.js";
import { computeNotes, formatNotesBlock } from "./notes.js";

export function parseCharacterData(
  raw: CharData,
  sections: ParseSection = "full",
): string {
  const char = (raw?.data ?? raw) as CharData;

  // Supplement spell compendium with this character's chosen spells (cantrips etc.)
  addCharacterSpellsToCompendium(char);

  // computeCoreStats produces every value used across multiple sections.
  // After phases 3–8 every domain consumes `core` directly; only profBonus
  // is still needed inline (threaded into vitals for the formatter's prof line).
  const core = computeCoreStats(char);
  const { profBonus } = core;

  const identity  = computeIdentity(core);
  const vitals    = computeVitals(core);
  const ac        = computeAc(core);
  const stats     = computeStats(core);
  const defenses  = computeDefenses(core);
  const features  = computeFeatures(core);
  const actions   = computeActions(core);
  const spells    = computeSpells(core);
  const inv       = computeInventory(core);
  const notes     = computeNotes(core);

  const headerBlock        = formatHeaderBlock(identity);
  const vitalsBlock        = formatVitalsBlock(vitals, ac, profBonus);
  const statsBlock         = formatStatsBlock(stats);
  const defensesBlock      = formatDefensesBlock(defenses);
  const featuresBlock      = formatFeaturesBlock(features);
  const combatBlock        = formatCombatBlock(actions);
  const spellsBlock        = formatSpellsBlock(spells);
  const concentrationBlock = formatConcentrationBlock(spells);
  const inventoryBlock     = formatInventoryBlock(inv);
  const notesBlock         = formatNotesBlock(notes);

  const out: string[] = [...headerBlock];
  switch (sections) {
    case "summary":
      out.push(...vitalsBlock, ...statsBlock);
      break;
    case "combat":
      out.push(...vitalsBlock, ...statsBlock, ...defensesBlock, ...combatBlock);
      break;
    case "spells":
      out.push(...(spellsBlock.length ? spellsBlock : ["No spellcasting on this character."]));
      break;
    case "inventory":
      out.push(...inventoryBlock);
      break;
    case "features":
      out.push(...featuresBlock);
      break;
    case "concentration":
      out.push(...concentrationBlock);
      break;
    case "notes":
      out.push(...notesBlock);
      break;
    case "full":
    default:
      out.push(
        ...vitalsBlock, ...statsBlock, ...defensesBlock,
        ...featuresBlock, ...combatBlock, ...spellsBlock, ...inventoryBlock, ...notesBlock,
      );
      break;
  }
  return out.join("\n");
}
