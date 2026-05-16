#!/usr/bin/env -S npx tsx
/**
 * Live-character regression snapshot — Layer 3 of the refactor regression
 * strategy (see docs/character-refactor.md).
 *
 * Fetches a curated subset of public DnD Beyond characters from
 * testcharacters.md, runs each through parseCharacterData("full"), and prints
 * a single concatenated dump to stdout for visual diff.
 *
 * Workflow (per phase of the character.ts refactor):
 *
 *   git checkout main
 *   npx tsx scripts/snapshot-live-characters.mts > /tmp/before.txt
 *   git checkout refactor/character-phase-N
 *   npx tsx scripts/snapshot-live-characters.mts > /tmp/after.txt
 *   diff /tmp/before.txt /tmp/after.txt   # must be empty
 *
 * Requires `ddb_login` to have been run at least once on this machine — uses
 * the saved session cookies. Skips with a notice if no session is present.
 *
 * Output is intentionally not committed: characters contain PHB descriptions
 * (copyrighted) and DDB content updates over time would create churn.
 */

import { hasValidSession } from "../src/session-fetch.js";
import { parseCharacter } from "../src/tools/character.js";

// Curated subset chosen for code-path coverage — see docs/character-refactor.md
// for rationale. Keep small (~8) so a full run completes in <30s with the
// cobalt token cache warm.
interface SnapshotTarget {
  id: string;
  description: string;   // why this character is in the corpus
}

const TARGETS: SnapshotTarget[] = [
  { id: "14814039",  description: "Calderax Greycastle — L12 Tiefling Cleric — high-level full caster, deep spell list" },
  { id: "58640338",  description: "Xarius Wo Tan — L10 Goliath Barbarian/Rogue — multiclass" },
  { id: "112315775", description: "Flemin — L9 Hill Dwarf Monk (Open Hand) — Martial Arts, racial darkvision" },
  { id: "68903271",  description: "Aerin Forrestlimb — L5 Wood Elf Gloom Stalker Ranger — Dread Ambusher initiative" },
  { id: "155665213", description: "Clover Darkbloom — L2 Elf Druid — 2024 race variant header (Elven Lineage)" },
  { id: "40046334",  description: "Caikrana Qualanthri — L1 High Elf Sorcerer — Draconic Resilience unarmored AC" },
  { id: "112314883", description: "Ethelrede — L9 Human Champion Fighter — Remarkable Athlete" },
  { id: "145415789", description: "Vi — L10 Gnome Artificer (Artillerist) — non-PHB class" },
  { id: "152570649", description: "Dwarf Cleric (2024) — 2024 rules; race-categorised ASIs are vestigial (isGranted:false) and must be skipped — see BUG #1 in regression-report-2026-05-16.md" },
  { id: "26158232",  description: "Laena — L20 High Elf Rogue (Scout) — Scout's Superior Mobility emits `bonus speed-walking +10` (axis-specific; not `innate-`) — see BUG #3 in regression-report-2026-05-16.md" },
  { id: "42519628",  description: "Ehsu Ferncraig — L10 Kobold Ranger (Monster Slayer) — Tasha's optional Roving feature emits an orphan `class bonus speed-walking +5` modifier whose componentId is NOT in classFeatures; must be skipped because enableOptionalClassFeatures is false (website 40 ft = base 30 + Mobile feat +10 only)" },
  { id: "40080729",  description: "BillytheBard — L2 Human Bard — Jack of All Trades emits TWO half-proficiency mods: `subType:\"ability-checks\"` for skills + `subType:\"initiative\"` for initiative. Initiative path requires the explicit subType — see BUG #4 in regression-report-2026-05-16.md" },
  { id: "40193614",  description: "Petit Nuage — L5 V. Human Monk — has char.overrideHitPoints set (rolled HP), so max HP must come from the override field, not the baseHitPoints + CON×L auto-calc — see BUG #5 in regression-report-2026-05-16.md" },
];

async function main(): Promise<void> {
  if (!hasValidSession()) {
    process.stderr.write(
      "[snapshot-live-characters] No DDB session found.\n" +
      "Run `ddb_login` (via the MCP tool or the CLI) first, then retry.\n"
    );
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  process.stdout.write(`# Live-character snapshot — generated ${startedAt}\n`);
  process.stdout.write(`# Targets: ${TARGETS.length}\n`);
  process.stdout.write("\n");

  let failures = 0;

  for (const target of TARGETS) {
    process.stdout.write(`${"=".repeat(78)}\n`);
    process.stdout.write(`# ${target.description}\n`);
    process.stdout.write(`# ID: ${target.id}\n`);
    process.stdout.write(`${"=".repeat(78)}\n\n`);

    try {
      const output = await parseCharacter(target.id, "full");
      process.stdout.write(output);
      process.stdout.write("\n\n");
    } catch (err) {
      failures++;
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`!! FETCH FAILED: ${msg}\n\n`);
      process.stderr.write(`[snapshot-live-characters] ${target.id} failed: ${msg}\n`);
    }
  }

  if (failures > 0) {
    process.stderr.write(`\n[snapshot-live-characters] ${failures}/${TARGETS.length} targets failed.\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[snapshot-live-characters] Fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
