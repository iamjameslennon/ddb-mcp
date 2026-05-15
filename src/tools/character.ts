import { sessionFetch, hasValidSession, getCobaltToken } from "../session-fetch.js";
import { TtlCache } from "../cache.js";
import { addCharacterSpellsToCompendium, isConcentrationSpell } from "./reference.js";
import { stripHtml as stripHtmlFull } from "../utils.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, resolve, relative, basename, dirname, isAbsolute } from "path";
import { homedir } from "os";
import type { CharData, ParseSection } from "./character/types.js";
import {
  str, num, arr, obj, signed, hasTag, stripHtml,
  statNames,
} from "./character/helpers.js";
import { computeCoreStats } from "./character/core.js";
import { computeIdentity, formatHeaderBlock } from "./character/identity.js";
import { computeVitals, formatVitalsBlock } from "./character/vitals.js";
import { computeAc } from "./character/ac.js";
import { computeStats, formatStatsBlock } from "./character/stats.js";
import { computeDefenses, formatDefensesBlock } from "./character/defenses.js";

// Cache character JSON to avoid redundant API calls within a session.
// TTL is configurable via DDB_CHARACTER_CACHE_TTL (seconds); default 60 s.
const CHARACTER_CACHE_TTL_MS = (() => {
  const raw = process.env.DDB_CHARACTER_CACHE_TTL;
  const seconds = raw ? parseInt(raw, 10) : 60;
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
})();
const characterCache = new TtlCache<string>(CHARACTER_CACHE_TTL_MS, 50);

/** Wipe the in-process character JSON cache. */
export function clearCharacterCache(): void {
  characterCache.clear();
}

// ── Character name resolution ─────────────────────────────────────────────────

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Resolve a character name to a numeric ID using the character list API.
 * Resolution order: exact match → substring match → Levenshtein ≤3 on full
 * name and individual words (e.g. "Throin" matches "Thorin Ironforge").
 * Returns null if no match or multiple ambiguous fuzzy matches are found.
 */
export async function findCharacterByName(name: string): Promise<{ id: string; name: string } | null> {
  // Throw rather than return null when there's no session — otherwise callers
  // surface a misleading "No character found matching '<name>'" message that
  // looks like the character doesn't exist, when really the user just hasn't
  // logged in yet.
  if (!hasValidSession()) {
    throw new Error("No session found. Please run ddb_login first to authenticate.");
  }
  const { token, userId } = await getCobaltToken();
  const resp = await sessionFetch(
    `https://character-service.dndbeyond.com/character/v5/characters/list?userId=${userId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return null;
  const result = await resp.json() as {
    data?: { characters?: Array<{ id: number; name: string }> };
  };
  const chars = (result.data?.characters ?? []).map(c => ({ id: String(c.id), name: c.name }));
  const lower = name.toLowerCase();

  // 1. Exact match
  const exact = chars.find(c => c.name.toLowerCase() === lower);
  if (exact) return exact;

  // 2. Substring match (only if unambiguous)
  const sub = chars.filter(c => c.name.toLowerCase().includes(lower));
  if (sub.length === 1) return sub[0];

  // 3. Levenshtein fuzzy match on full name and individual words
  const fuzzy = chars.filter(c => {
    if (levenshteinDistance(lower, c.name.toLowerCase()) <= 3) return true;
    return c.name.split(/\s+/).some(w => levenshteinDistance(lower, w.toLowerCase()) <= 3);
  });
  if (fuzzy.length === 1) return fuzzy[0];

  return null;
}

export function parseCharacterData(
  raw: CharData,
  sections: ParseSection = "full"
): string {
  const char = (raw?.data ?? raw) as CharData;

  // Supplement spell compendium with this character's chosen spells (cantrips etc.)
  addCharacterSpellsToCompendium(char);

  // Helpers (str/num/arr/obj/signed/hasTag/stripHtml) and statNames are
  // imported from ./character/helpers.js.
  //
  // computeCoreStats produces every value used across multiple sections.
  // We keep both `core` (for passing whole to per-domain modules) and the
  // destructured locals (for inline use further down). Phase 2 of the refactor.
  const core = computeCoreStats(char);
  const {
    allMods, classes, profBonus,
    statMods, inventory, resolveTemplates,
  } = core;

  // ── Identity & Vitals ─────────────────────────────────────────────────────
  // Computed in ./character/identity.js and ./character/vitals.js (Phase 3 of the refactor).
  // Vitals owns HP, hit dice, speed, initiative, death saves. AC is its own
  // module (Phase 4) — for now, AC is computed inline below and threaded into
  // formatVitalsBlock as a separate parameter.
  const identity = computeIdentity(core);
  const vitals = computeVitals(core);

  // dexMod is needed by weapon attacks (Phase 6). Keep one local convenience
  // binding here until that phase lands.
  const dexMod = statMods[1];

  // ── Armor Class ───────────────────────────────────────────────────────────
  // Computed in ./character/ac.js (Phase 4 of the refactor).
  const ac = computeAc(core);

  // ── Stats (saves / skills / senses / proficiencies) ──────────────────────
  // Computed in ./character/stats.js (Phase 5 of the refactor).
  const stats = computeStats(core);

  // ── Defenses & Conditions ─────────────────────────────────────────────────
  // Computed in ./character/defenses.js (Phase 5b of the refactor).
  const defenses = computeDefenses(core);

  // ── Feats ─────────────────────────────────────────────────────────────────
  // DDB stores some non-feat entries in the feats array.
  // __DISGUISE_FEAT = class features surfaced as feats (shown in OTHER FEATURES).
  // __INITIAL_ASI   = 2024 background Ability Score Improvements (already in ABILITY SCORES; drop entirely).
  const allFeats = arr<Record<string, unknown>>(char.feats);
  const realFeats = allFeats.filter(
    f => !hasTag(f, "__DISGUISE_FEAT") && !hasTag(f, "__INITIAL_ASI")
  );
  const disguisedFeats = allFeats.filter(f => hasTag(f, "__DISGUISE_FEAT"));
  const featLines = realFeats.map(f => {
    const def = obj(f.definition);
    const snippet = resolveTemplates(stripHtml(str(def.snippet || def.description))).slice(0, 120);
    return `• ${str(def.name)}${snippet ? `: ${snippet}${snippet.length >= 120 ? "…" : ""}` : ""}`;
  });

  // ── Class Features ────────────────────────────────────────────────────────
  const classFeatureLines: string[] = [];
  const seenClassFeatures = new Set<string>();
  for (const c of classes) {
    const charLevel = num(c.level);
    for (const cf of arr<Record<string, unknown>>(c.classFeatures)) {
      const def = obj(cf.definition);
      const line = `• ${str(def.name)} (${str(obj(c.definition).name)} ${num(def.requiredLevel || 1)})`;
      if (num(def.requiredLevel || 0) <= charLevel && !seenClassFeatures.has(line)) {
        seenClassFeatures.add(line);
        classFeatureLines.push(line);
      }
    }
  }

  // ── Racial Traits ─────────────────────────────────────────────────────────
  const racialTraitLines = arr<Record<string, unknown>>(obj(char.race).racialTraits).map(
    t => `• ${str(obj(t.definition).name)}`
  );

  // ── Background Feature ────────────────────────────────────────────────────
  // For custom backgrounds, featureName may reflect a feat name rather than
  // the actual background feature. Check customBackground first if present.
  const bgObj = obj(char.background);
  const customBg = obj(bgObj.customBackground);
  const featuresBackgroundDef = obj(obj(customBg.featuresBackground).definition);
  const customBgDef = Object.keys(featuresBackgroundDef).length > 0
    ? featuresBackgroundDef
    : obj(customBg.definition);
  const bgDef = Object.keys(customBgDef).length > 0 ? customBgDef : obj(bgObj.definition);
  const bgFeatureName = str(bgDef.featureName);
  const bgFeatureIsFeat = bgDef.featureIsFeat === true;
  const bgFeatureDesc = bgDef.featureDescription
    ? resolveTemplates(stripHtml(str(bgDef.featureDescription))).slice(0, 300)
    : "";

  // ── Actions / Bonus Actions / Reactions / Limited Use ─────────────────────
  // activation.activationType: 1=action, 3=bonus action, 4=reaction, 8=special (skip)
  // Filter Circle Spell entries — these leak from the Dark Bargain campaign feature
  // and don't represent real character abilities on the website.
  const allActions = Object.values(obj(char.actions))
    .flatMap(v => arr<Record<string, unknown>>(v))
    .filter(a => a != null && !str(a.name).startsWith("Circle Spell") && str(a.name) !== "Initiate a Circle Spell");
  const activationType = (a: Record<string, unknown>) => num(obj(a.activation).activationType);

  // Bonus-action and reaction spells — activationType 3=bonus action, 4=reaction.
  // Apply the same prepared/ritual filter used in the main SPELLS section for spellbook
  // classes (Wizards) so unprepared non-ritual spells don't bleed into these sections.
  const allCharSpells = [
    ...arr<Record<string, unknown>>(char.classSpells).flatMap(cs => {
      const classEntry = classes.find(c => c.id === cs.characterClassId);
      const isSpellbook = str(obj(classEntry?.definition ?? {}).name) === "Wizard";
      return arr<Record<string, unknown>>(cs.spells).filter(s =>
        !isSpellbook || s.prepared === true || obj(s.definition).ritual === true
      );
    }),
    ...Object.values(obj(char.spells)).flatMap(v => arr<Record<string, unknown>>(v)),
  ].filter(Boolean);
  const spellActivationType = (s: Record<string, unknown>) =>
    num(obj(obj(s.definition).activation).activationType);
  const formatSpell = (s: Record<string, unknown>) => {
    const def = obj(s.definition);
    const lvl = num(def.level);
    const slotStr = lvl === 0 ? "cantrip" : `${lvl === 1 ? "1st" : lvl === 2 ? "2nd" : lvl === 3 ? "3rd" : `${lvl}th`}-level slot`;
    return `• ${str(def.name)} (spell, ${slotStr})`;
  };
  // Spell activationTypes (from rule-data): 1=Action, 2=No Action, 3=Bonus Action, 4=Reaction, 8=Special
  const bonusActionSpells = allCharSpells.filter(s => spellActivationType(s) === 3).map(formatSpell);
  const reactionSpells = allCharSpells.filter(s => spellActivationType(s) === 4).map(formatSpell);

  // activationType 3 = bonus action in class actions, 4 = reaction
  // activationType 1 = action (weapon masteries — skip, shown in ACTIONS already)
  // activationType 8 = special/passive — skip
  const bonusActions = [
    ...allActions.filter(a => activationType(a) === 3).map(a => `• ${str(a.name)}`),
    ...bonusActionSpells,
  ];
  // Reactions: Opportunity Attack is universal, then class reactions, then reaction spells
  const reactions: string[] = [
    "• Opportunity Attack",
    ...allActions.filter(a => activationType(a) === 4).map(a => `• ${str(a.name)}`),
    ...reactionSpells,
  ];
  const limitedUseFeatures = allActions
    .filter(a => {
      const lu = obj(a.limitedUse);
      // maxUses=0 with statModifierUsesId means uses = that stat modifier (e.g. CHA for Bardic Inspiration)
      return lu.maxUses !== undefined && (num(lu.maxUses) > 0 || lu.statModifierUsesId != null);
    })
    .map(a => {
      const lu = obj(a.limitedUse);
      const resetLabels: Record<number, string> = { 1: "Short Rest", 2: "Long Rest" };
      const reset = resetLabels[num(lu.resetType)] ?? "Rest";
      let maxStr = num(lu.maxUses) > 0
        ? String(num(lu.maxUses))
        : lu.statModifierUsesId != null
          ? `${signed(statMods[num(lu.statModifierUsesId) - 1])} (stat)`
          : "?";
      const used = num(lu.numberUsed);
      return `• ${str(a.name)}   ${used} used / ${maxStr} max   (${reset})`;
    });

  // ── Weapon Attacks ────────────────────────────────────────────────────────
  const weaponProfSlugs = new Set(
    allMods.filter(m => m.type === "proficiency").map(m => str(m.subType))
  );
  const isWeaponProficient = (def: Record<string, unknown>): boolean => {
    const catId = num(def.categoryId); // 1=simple, 2=martial
    const typeName = str(def.type).toLowerCase().replace(/[,\s]+/g, "-");
    return (catId === 1 && weaponProfSlugs.has("simple-weapons")) ||
           (catId === 2 && weaponProfSlugs.has("martial-weapons")) ||
           weaponProfSlugs.has(typeName);
  };

  // Martial Arts: allows DEX for monk weapons (simple melee + shortsword, no Two-Handed/Heavy)
  const hasMartialArts =
    allMods.some(m => str(m.subType) === "martial-arts") ||
    classes.some(c =>
      arr<Record<string, unknown>>(c.classFeatures).some(cf =>
        str(obj(cf.definition).name) === "Martial Arts" &&
        num(obj(cf.definition).requiredLevel || 1) <= num(c.level)
      )
    );

  const weaponAttacks: string[] = [];
  const weaponInventoryMap = new Map<string, { lines: string[]; qty: number }>();
  for (const i of inventory) {
    const def = obj(i.definition);
    if (str(def.filterType) !== "Weapon") continue;
    if (i.equipped !== true) continue; // only show equipped weapons in ACTIONS

    const wName = str(def.name);
    const dmg = obj(def.damage);
    const dmgDice = str(dmg.diceString);
    const dmgType = str(def.damageType).toLowerCase();
    const attackType = num(def.attackType); // 1=melee, 2=ranged
    const props = arr<Record<string, unknown>>(def.properties).map(p => str(p.name));
    const isFinesse = props.includes("Finesse");
    const isRanged = attackType === 2;
    const range = num(def.range);
    const longRange = num(def.longRange);
    const mastery = str(def.mastery);

    // Magic enhancement bonus from grantedModifiers (e.g. +1 weapon)
    const magicBonus = arr<Record<string, unknown>>(def.grantedModifiers)
      .filter(gm => gm.type === "bonus" && gm.subType === "magic")
      .reduce((s, gm) => s + num(gm.value ?? gm.fixedValue), 0);

    // Monk weapons: simple melee or shortsword, no Two-Handed/Heavy
    const isMonkWeapon = hasMartialArts &&
      !props.includes("Two-Handed") && !props.includes("Heavy") &&
      ((num(def.categoryId) === 1 && attackType === 1) || str(def.name) === "Shortsword");

    // Ability modifier for attack/damage
    const usesDex = isRanged || ((isFinesse || isMonkWeapon) && dexMod > statMods[0]);
    const abilityMod = usesDex ? dexMod : statMods[0];
    const profMod = isWeaponProficient(def) ? profBonus : 0;
    const hitBonus = abilityMod + profMod + magicBonus;
    const dmgBonus = abilityMod + magicBonus;
    const dmgStr = dmgBonus !== 0 ? `${dmgDice}${signed(dmgBonus)}` : dmgDice;
    const rangeStr = isRanged ? `range ${range}/${longRange} ft.` : `reach 5 ft.`;
    const propsStr = [...props, ...(mastery ? [mastery] : [])].join(", ");

    const line = `• ${wName.padEnd(16)} ${signed(hitBonus)} to hit   ${dmgStr} ${dmgType}   ${rangeStr}${propsStr ? `   ${propsStr}` : ""}`;

    // Consolidate duplicates by key
    const key = wName + dmgDice;
    const existing = weaponInventoryMap.get(key);
    if (existing) {
      existing.qty += num(i.quantity) || 1;
    } else {
      weaponInventoryMap.set(key, { lines: [line], qty: num(i.quantity) || 1 });
    }
  }
  for (const { lines, qty } of weaponInventoryMap.values()) {
    weaponAttacks.push(qty > 1 ? lines[0].replace("•", `• ×${qty}`) : lines[0]);
  }

  // ── Spellcasting ──────────────────────────────────────────────────────────
  // spellCastingAbilityId: 1=STR 2=DEX 3=CON 4=INT 5=WIS 6=CHA
  const spellcastingLines: string[] = [];
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
    spellcastingLines.push(
      `  ${className}: ${statNames[abilityId - 1]}  Spell Attack: ${signed(spellAttack)}  Save DC: ${saveDc}`
    );
  }

  // ── Spell Slots ───────────────────────────────────────────────────────────
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
  const slotLines = Object.entries(slotMax)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([lvl, max]) => {
      const used = spellSlotUsed[Number(lvl)] ?? 0;
      return `  Level ${lvl}: ${max - used}/${max}`;
    });

  // ── Spells ────────────────────────────────────────────────────────────────
  const spellSections: string[] = [];
  const classSpells = arr<Record<string, unknown>>(char.classSpells);
  // seenSpellIds is pre-seeded here so cross-source duplicate detection also
  // catches class-feature auto-grants of spells the player already has prepared.
  const seenSpellIds = new Map<number, string>(); // spellId → first source label
  for (const cs of classSpells) {
    // Try characterClassId first; fall back to id/classId for 2024-rules format
    const classEntry = classes.find(c =>
      c.id === cs.characterClassId ||
      c.id === cs.id ||
      c.id === cs.classId
    );
    const className = str(obj(classEntry?.definition ?? {}).name);
    const isSpellbook = className === "Wizard";
    // spells may be under cs.spells or cs.classSpells (2024 format variation)
    const allSpells = arr<Record<string, unknown>>(cs.spells).length > 0
      ? arr<Record<string, unknown>>(cs.spells)
      : arr<Record<string, unknown>>(cs.classSpells);
    const cantrips = allSpells
      .filter(s => num(obj(s.definition).level) === 0)
      .map(s => str(obj(s.definition).name));
    const leveled = allSpells
      .filter(s => {
        if (num(obj(s.definition).level) === 0) return false;
        if (isSpellbook) return s.prepared === true || obj(s.definition).ritual === true;
        return true;
      })
      .map(s => {
        const def = obj(s.definition);
        const ritual = isSpellbook && def.ritual ? " [ritual]" : "";
        return `${str(def.name)} (L${num(def.level)}${ritual})`;
      });
    if (cantrips.length) spellSections.push(`  Cantrips: ${cantrips.join(", ")}`);
    if (leveled.length) spellSections.push(`  Spells: ${leveled.join(", ")}`);
    // Pre-seed duplicate detection in the same pass
    for (const s of allSpells) {
      const spellId = num(obj(s.definition).id);
      if (spellId && !seenSpellIds.has(spellId)) seenSpellIds.set(spellId, "Spells");
    }
  }
  const spellsObj = obj(char.spells);
  const sourceLabels: Record<string, string> = {
    race: "Racial Trait", class: "Class Feature", background: "Background", feat: "Feat", item: "Item",
  };
  const duplicateWarnings: string[] = [];

  for (const [key, label] of Object.entries(sourceLabels)) {
    const spellList = arr<Record<string, unknown>>(spellsObj[key]);
    if (!spellList.length) continue;
    const names = [...new Set(
      spellList
        .filter(s => {
          const def = obj(s.definition);
          const spellId = num(def.id);
          if (!spellId) return true;
          if (seenSpellIds.has(spellId)) {
            const firstLabel = seenSpellIds.get(spellId)!;
            const spellName = str(def.name);
            const lvl = num(def.level);
            const spellStr = lvl === 0 ? spellName : `${spellName} (L${lvl})`;
            duplicateWarnings.push(`  • ${spellStr} — already granted by ${firstLabel}, also in ${label}`);
            return false;
          }
          seenSpellIds.set(spellId, label);
          return true;
        })
        .map(s => {
          const def = obj(s.definition);
          const n = str(def.name);
          return n ? (num(def.level) === 0 ? n : `${n} (L${num(def.level)})`) : "";
        })
        .filter(n => n.length > 0)
    )];
    if (names.length) spellSections.push(`  From ${label}: ${names.join(", ")}`);
  }

  if (duplicateWarnings.length) {
    spellSections.push(
      `  ⚠ Duplicate spell grants detected — the following spells are already`,
      `  provided by an earlier source; the extra grant may be a wasted choice:`,
      ...duplicateWarnings
    );
  }

  // ── Full Inventory ────────────────────────────────────────────────────────
  const equippedNonWeapons: string[] = [];
  const carriedItems = new Map<string, number>();
  let attuned = 0;
  for (const i of inventory) {
    const def = obj(i.definition);
    const iName = str(def.name);
    const filterType = str(def.filterType);
    const qty = num(i.quantity) || 1;
    if (i.isAttuned) attuned++;
    if (i.equipped && filterType === "Armor") {
      const ac2 = num(def.armorClass);
      equippedNonWeapons.push(`${iName}${ac2 ? ` (AC ${ac2})` : ""}`);
    } else if (filterType !== "Weapon") {
      carriedItems.set(iName, (carriedItems.get(iName) ?? 0) + qty);
    }
  }
  const inventoryLine = [...carriedItems.entries()]
    .map(([n, q]) => q > 1 ? `${n} ×${q}` : n)
    .join(", ");

  // ── Currency ──────────────────────────────────────────────────────────────
  const currencies = obj(char.currencies);
  const currencyLine = ["pp","gp","ep","sp","cp"]
    .map(c => `${num(currencies[c])}${c}`)
    .filter(c => !c.startsWith("0"))
    .join(", ") || "none";

  // ── Assemble named blocks ─────────────────────────────────────────────────
  // headerBlock and vitalsBlock are produced by ./character/identity.js and
  // ./character/vitals.js (Phase 3). AC is still computed inline above.
  const headerBlock = formatHeaderBlock(identity);
  const vitalsBlock = formatVitalsBlock(vitals, ac, profBonus);

  const statsBlock = formatStatsBlock(stats);

  const defensesBlock = formatDefensesBlock(defenses);

  const featuresBlock: string[] = [
    `FEATS (${realFeats.length})`,
    ...(featLines.length ? featLines : ["  (none)"]),
    ``,
    ...(disguisedFeats.length ? [
      `OTHER FEATURES (stored as feats in API but NOT player-chosen feats)`,
      ...disguisedFeats.map(f => `• ${str(obj(f.definition).name)}`),
      ``,
    ] : []),
    `CLASS FEATURES`,
    ...classFeatureLines,
    ``,
    `RACIAL TRAITS`,
    ...racialTraitLines,
    ``,
    ...(!bgFeatureName || bgFeatureIsFeat ? [] : (() => {
      const descSnippet = bgFeatureDesc
        ? `${bgFeatureDesc}${bgFeatureDesc.length >= 300 ? "…" : ""}` : "";
      return [
        `BACKGROUND FEATURE`,
        `  ${bgFeatureName}${descSnippet ? `: ${descSnippet}` : ""}`,
        ``,
      ];
    })()),
  ];

  const combatBlock: string[] = [
    `ACTIONS`,
    ...(weaponAttacks.length ? weaponAttacks : ["  (none)"]),
    ``,
    `BONUS ACTIONS`,
    ...(bonusActions.length ? bonusActions : ["  (none)"]),
    ``,
    `REACTIONS`,
    ...(reactions.length ? reactions : ["  (none)"]),
    ``,
    ...(limitedUseFeatures.length ? [`LIMITED USE`, ...limitedUseFeatures, ``] : []),
  ];

  const spellsBlock: string[] = [
    ...(spellcastingLines.length ? [`SPELLCASTING`, ...spellcastingLines, ``] : []),
    ...(slotLines.length ? [`SPELL SLOTS`, ...slotLines, ``] : []),
    ...(spellSections.length ? [`SPELLS`, ...spellSections, ``] : []),
  ];

  // ── Concentration Spells ──────────────────────────────────────────────────────
  // Collect all available/prepared spells, filter to concentration:true, group by level.
  const concByLevel = new Map<number, string[]>();
  const addConcSpell = (s: Record<string, unknown>) => {
    const def = obj(s.definition);
    const name = str(def.name);
    if (!name) return;
    const level = num(def.level);
    const fromCompendium = isConcentrationSpell(name);
    const isConc = fromCompendium !== null ? fromCompendium : def.concentration === true;
    if (!isConc) return;
    const bucket = concByLevel.get(level) ?? [];
    if (!bucket.includes(name)) { bucket.push(name); concByLevel.set(level, bucket); }
  };
  for (const cs of classSpells) {
    const classEntry = classes.find(c =>
      c.id === cs.characterClassId || c.id === cs.id || c.id === cs.classId
    );
    const isSpellbook2 = str(obj(classEntry?.definition ?? {}).name) === "Wizard";
    const allSp = arr<Record<string, unknown>>(cs.spells).length > 0
      ? arr<Record<string, unknown>>(cs.spells)
      : arr<Record<string, unknown>>(cs.classSpells);
    for (const s of allSp) {
      const def = obj(s.definition);
      if (num(def.level) > 0 && isSpellbook2 && !(s.prepared === true || def.ritual === true)) continue;
      addConcSpell(s);
    }
  }
  for (const spellList of Object.values(spellsObj)) {
    for (const s of arr<Record<string, unknown>>(spellList)) addConcSpell(s);
  }
  const slotOrdinal = (lvl: number) => {
    const o = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
    return o[lvl] ?? `${lvl}th`;
  };
  const concentrationBlock: string[] = [];
  if (concByLevel.size === 0) {
    concentrationBlock.push("This character has no concentration spells prepared.");
  } else {
    concentrationBlock.push("CONCENTRATION SPELLS");
    for (const lvl of [...concByLevel.keys()].sort((a, b) => a - b)) {
      concentrationBlock.push(lvl === 0 ? "  Cantrips (no slot required):" : `  Level ${lvl}:`);
      for (const name of concByLevel.get(lvl)!) {
        concentrationBlock.push(`    • ${name}${lvl > 0 ? ` [${slotOrdinal(lvl)}-level slot]` : ""}`);
      }
    }
    concentrationBlock.push("");
    if (slotLines.length) concentrationBlock.push("SPELL SLOTS", ...slotLines);
  }

  // ── Notes & Backstory ────────────────────────────────────────────────────────
  const traits = obj(char.traits);
  const notes  = obj(char.notes);
  const field  = (v: unknown) => { const s = stripHtmlFull(str(v)).trim(); return s || null; };

  const traitLines: string[] = [];
  const addTrait = (label: string, v: unknown) => { const t = field(v); if (t) traitLines.push(`  ${label.padEnd(13)}${t}`); };
  addTrait("Traits:",     traits.personalityTraits);
  addTrait("Ideals:",     traits.ideals);
  addTrait("Bonds:",      traits.bonds);
  addTrait("Flaws:",      traits.flaws);
  addTrait("Appearance:", traits.appearance);

  const backstoryText = field(notes.backstory);

  const allyLines: string[] = [];
  const addAlly = (label: string, v: unknown) => { const t = field(v); if (t) allyLines.push(`  ${label.padEnd(15)}${t}`); };
  addAlly("Allies:",        notes.allies);
  addAlly("Organisations:", notes.organizations);

  const extraLines: string[] = [];
  const addExtra = (label: string, v: unknown) => { const t = field(v); if (t) extraLines.push(`  ${label.padEnd(13)}${t}`); };
  addExtra("Possessions:", notes.personalPossessions);
  addExtra("Other:",       notes.otherNotes);

  const notesBlock: string[] = [];
  const hasAny = traitLines.length || backstoryText || allyLines.length || extraLines.length;
  if (!hasAny) {
    notesBlock.push("No notes or backstory have been recorded for this character.");
  } else {
    if (traitLines.length) notesBlock.push("PERSONALITY", ...traitLines, "");
    if (backstoryText)     notesBlock.push("BACKSTORY", `  ${backstoryText}`, "");
    if (allyLines.length)  notesBlock.push("ALLIES & ORGANISATIONS", ...allyLines, "");
    if (extraLines.length) notesBlock.push("ADDITIONAL NOTES", ...extraLines, "");
  }

  const inventoryBlock: string[] = [
    ...(equippedNonWeapons.length ? [`EQUIPPED`, ...equippedNonWeapons.map(e => `  ${e}`), ``] : []),
    ...(inventoryLine ? [`INVENTORY`, `  ${inventoryLine}`, ``] : []),
    `ATTUNEMENT: ${attuned}/3 slots used`,
    ``,
    `CURRENCY: ${currencyLine}`,
  ];

  // ── Select blocks by section ──────────────────────────────────────────────
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

export async function parseCharacter(
  characterId: string,
  sections: ParseSection = "full"
): Promise<string> {
  const jsonData = await getCharacter(characterId);
  const raw = JSON.parse(jsonData) as Record<string, unknown>;
  return parseCharacterData(raw, sections);
}

/**
 * Fetch raw character JSON from the DnD Beyond API.
 * Uses saved session cookies — no browser needed after initial login.
 */
export async function getCharacter(
  characterId: string
): Promise<string> {
  const cacheKey = `character:${characterId}`;
  const cached = characterCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = `https://character-service.dndbeyond.com/character/v5/character/${encodeURIComponent(characterId)}?includeCustomItems=true`;

  // Public characters work without auth. Use session cookies if available so
  // private/campaign-only characters owned by the logged-in user also work.
  const resp = hasValidSession()
    ? await sessionFetch(url)
    : await fetch(url, { headers: { Accept: "application/json" } });

  if (resp.ok) {
    const result = await resp.json();
    const json = JSON.stringify(result);
    characterCache.set(cacheKey, json);
    return json;
  }

  // 404 = character doesn't exist; 403 = private
  if (resp.status === 403) {
    throw new Error(`Character ${characterId} is private and cannot be accessed.`);
  }
  throw new Error(`DnD Beyond API returned ${resp.status}: ${resp.statusText}`);
}

export async function downloadCharacter(
  characterId: string,
  outputPath?: string
): Promise<string> {
  const jsonData = await getCharacter(characterId);
  const parsed = JSON.parse(jsonData);
  const charName: string = parsed?.data?.name ?? `character-${characterId}`;

  // Sanitize the character name: keep only alphanumeric, spaces, hyphens, apostrophes.
  // basename ensures no path separators survive; the allowlist strips anything else.
  const safeName = basename(charName)
    .replace(/[^a-zA-Z0-9 '\-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 64) || `character-${characterId}`;
  const filename = `${safeName}-${characterId}.json`;
  const downloadsDir = join(homedir(), "Downloads");
  const defaultPath = join(downloadsDir, filename);

  let savePath: string;
  if (outputPath) {
    const resolved = resolve(outputPath);
    if (resolved.includes("\0")) throw new Error("Output path contains invalid characters.");
    const allowedDirs = [
      join(homedir(), "Downloads"),
      join(homedir(), "Documents"),
    ];
    // Require resolved to be a strict child of an allowed dir — rel must be
    // non-empty (rejects passing the root itself, which would later EISDIR),
    // not escape with .., and not be absolute (cross-drive on Windows).
    const isAllowed = allowedDirs.some(dir => {
      const rel = relative(dir, resolved);
      return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
    });
    if (!isAllowed) {
      throw new Error("Output path must be a file under ~/Downloads or ~/Documents.");
    }
    savePath = resolved;
  } else {
    savePath = defaultPath;
  }

  // Minimal Linux installs (and some Windows profiles) don't ship with ~/Downloads
  // or ~/Documents — create the target dir so the write doesn't ENOENT. Safe to
  // do unconditionally because the allowlist above already constrained savePath.
  try {
    mkdirSync(dirname(savePath), { recursive: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new Error(
      `Cannot create directory ${dirname(savePath)} (${code ?? "unknown"}). ` +
      `Pass output_path pointing to an existing directory under ~/Downloads or ~/Documents.`
    );
  }
  writeFileSync(savePath, JSON.stringify(parsed, null, 2), "utf8");
  return `Character data for '${charName}' saved to: ${savePath}`;
}

export async function listCharacters(): Promise<string> {
  if (!hasValidSession()) {
    throw new Error("No session found. Please run ddb_login first.");
  }

  const { token, userId } = await getCobaltToken();
  const resp = await sessionFetch(
    `https://character-service.dndbeyond.com/character/v5/characters/list?userId=${userId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) throw new Error(`Character list API returned ${resp.status}: ${resp.statusText}`);

  const result = await resp.json() as {
    data?: {
      characters?: Array<{
        id: number; name: string; level: number; raceName: string;
        classDescription: string; campaignId: number | null; campaignName: string | null;
        statusSlug: string;
      }>;
    };
  };

  const characters = (result.data?.characters ?? []).map((c) => ({
    id: String(c.id),
    name: c.name,
    level: c.level,
    race: c.raceName,
    class: c.classDescription,
    status: c.statusSlug,
    campaignId: c.campaignId ? String(c.campaignId) : null,
    campaignName: c.campaignName ?? null,
  }));

  return JSON.stringify(characters);
}

// ── Definition Lookup ─────────────────────────────────────────────────────────


function matchesDefinitionQuery(name: string, query: string): boolean {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n.includes(q)) return true;
  return name.split(/\s+/).some(w => levenshteinDistance(q, w.toLowerCase()) <= 2);
}

function formatSpellResult(spell: Record<string, unknown>): string {
  const d = (spell.definition ?? spell) as Record<string, unknown>;
  const name = String(d.name ?? "Unknown");
  const level = Number(d.level ?? 0);
  const school = String(d.school ?? "");
  const levelLabel = level === 0 ? "Cantrip" : `Level ${level}`;

  const ACTIVATION_TYPES: Record<number, string> = { 1: "Action", 3: "Bonus Action", 6: "Reaction" };
  const act = d.activation as Record<string, unknown> | undefined;
  const castingTime = act
    ? `${act.activationTime} ${ACTIVATION_TYPES[Number(act.activationType)] ?? "Action"}`
    : "1 Action";

  const rng = d.range as Record<string, unknown> | undefined;
  let range = "Self";
  if (rng) {
    if (rng.rangeValue && rng.origin !== "Self") range = `${rng.rangeValue} ft`;
    else range = String(rng.origin ?? "Self");
    if (rng.aoeType && rng.aoeValue) range += ` (${rng.aoeValue}-ft ${rng.aoeType})`;
  }

  const dur = d.duration as Record<string, unknown> | undefined;
  let duration = "Instantaneous";
  if (dur) {
    const isConc = dur.durationType === "Concentration";
    if (dur.durationInterval && dur.durationUnit) {
      duration = `${isConc ? "Concentration, up to " : ""}${dur.durationInterval} ${dur.durationUnit}${Number(dur.durationInterval) > 1 ? "s" : ""}`;
    } else if (isConc) {
      duration = "Concentration";
    }
  }

  const components = (Array.isArray(d.components) ? d.components : [])
    .map((c: number) => ({ 1: "V", 2: "S", 3: "M" })[c])
    .filter(Boolean)
    .join(", ");
  const matNote = d.componentsDescription ? ` (${d.componentsDescription})` : "";

  const lines = [
    `${name} (${levelLabel} ${school})`,
    `Casting Time: ${castingTime}`,
    `Range: ${range}`,
    `Components: ${components || "None"}${matNote}`,
    `Duration: ${duration}`,
  ];
  if (d.ritual) lines.push("Ritual: Yes");
  lines.push("", stripHtmlFull(String(d.description ?? "")));
  return lines.join("\n");
}

function formatFeatResult(feat: Record<string, unknown>): string {
  const d = (feat.definition ?? feat) as Record<string, unknown>;
  const lines = [String(d.name ?? "Unknown")];
  if (d.prerequisite) lines.push(`Prerequisite: ${d.prerequisite}`);
  lines.push("", stripHtmlFull(String(d.description ?? d.snippet ?? "")));
  return lines.join("\n");
}

function formatClassFeatureResult(
  feature: Record<string, unknown>,
  className: string,
  level: number
): string {
  const d = (feature.definition ?? feature) as Record<string, unknown>;
  const name = String(d.name ?? feature.name ?? "Unknown");
  const desc = stripHtmlFull(String(d.description ?? d.snippet ?? ""));
  return `${name} (${className}, Level ${level})\n\n${desc}`;
}

function formatRacialTraitResult(trait: Record<string, unknown>, raceName: string): string {
  const d = (trait.definition ?? trait) as Record<string, unknown>;
  const name = String(d.name ?? "Unknown");
  const desc = stripHtmlFull(String(d.description ?? d.snippet ?? ""));
  return `${name} (${raceName})\n\n${desc}`;
}

function formatItemResult(item: Record<string, unknown>): string {
  const d = (item.definition ?? item) as Record<string, unknown>;
  const name = String(d.name ?? "Unknown");
  const type = String(d.type ?? "Item");
  const rarity = String(d.rarity ?? "Common");
  const weight = d.weight != null ? `Weight: ${d.weight} lb\n` : "";
  const desc = stripHtmlFull(String(d.description ?? ""));
  return `${name} (${type}, ${rarity})\n${weight}\n${desc}`;
}

interface DefinitionHit {
  type: string;
  text: string;
}

function searchDefinitions(char: Record<string, unknown>, query: string): DefinitionHit[] {
  const results: DefinitionHit[] = [];

  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const obj = (v: unknown): Record<string, unknown> =>
    v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? v : 0);

  // ── Spells ────────────────────────────────────────────────────────────────
  const allSpells: Record<string, unknown>[] = [
    ...arr<Record<string, unknown>>(char.classSpells).flatMap(cs =>
      arr<Record<string, unknown>>(cs.spells)
    ),
    ...Object.values(obj(char.spells)).flatMap(v => arr<Record<string, unknown>>(v)),
  ];
  for (const spell of allSpells) {
    const name = str(obj(spell.definition).name || spell.name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push({ type: "Spell", text: formatSpellResult(spell) });
    }
  }

  // ── Feats ─────────────────────────────────────────────────────────────────
  for (const feat of arr<Record<string, unknown>>(char.feats)) {
    const name = str(obj(feat.definition).name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push({ type: "Feat", text: formatFeatResult(feat) });
    }
  }

  // ── Class & Subclass Features ─────────────────────────────────────────────
  const seen = new Set<string>();
  for (const cls of arr<Record<string, unknown>>(char.classes)) {
    const charLevel = num(cls.level);
    const className = str(obj(cls.definition).name);

    for (const cf of arr<Record<string, unknown>>(cls.classFeatures)) {
      const d = obj(cf.definition);
      const name = str(d.name);
      const requiredLevel = num(d.requiredLevel || 1);
      if (requiredLevel <= charLevel && name && matchesDefinitionQuery(name, query) && !seen.has(name)) {
        seen.add(name);
        results.push({
          type: "Class Feature",
          text: formatClassFeatureResult(cf, className, requiredLevel),
        });
      }
    }

    const subDef = obj(cls.subclassDefinition);
    const subName = str(subDef.name);
    for (const cf of arr<Record<string, unknown>>(subDef.classFeatures)) {
      const d = obj(cf.definition);
      const name = str(d.name);
      const requiredLevel = num(d.requiredLevel || 1);
      const label = subName ? `${className} / ${subName}` : className;
      if (requiredLevel <= charLevel && name && matchesDefinitionQuery(name, query) && !seen.has(name)) {
        seen.add(name);
        results.push({
          type: "Subclass Feature",
          text: formatClassFeatureResult(cf, label, requiredLevel),
        });
      }
    }
  }

  // ── Racial Traits ─────────────────────────────────────────────────────────
  const raceName = str(obj(char.race).fullName || obj(char.race).baseName);
  for (const trait of arr<Record<string, unknown>>(obj(char.race).racialTraits)) {
    const name = str(obj(trait.definition).name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push({ type: "Racial Trait", text: formatRacialTraitResult(trait, raceName) });
    }
  }

  // ── Background Feature ────────────────────────────────────────────────────
  const bgDef = obj(obj(char.background).definition);
  const bgFeatureName = str(bgDef.featureName);
  if (bgFeatureName && matchesDefinitionQuery(bgFeatureName, query)) {
    const bgName = str(bgDef.name);
    const bgDesc = stripHtmlFull(str(bgDef.featureDescription));
    results.push({
      type: "Background Feature",
      text: `${bgFeatureName} (${bgName})\n\n${bgDesc}`,
    });
  }

  // ── Equipped Items ────────────────────────────────────────────────────────
  for (const item of arr<Record<string, unknown>>(char.inventory)) {
    if (!item.equipped) continue;
    const name = str(obj(item.definition).name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push({ type: "Item", text: formatItemResult(item) });
    }
  }

  return results;
}

export async function getDefinition(
  characterId: string,
  query: string
): Promise<string> {
  const jsonData = await getCharacter(characterId);
  const raw = JSON.parse(jsonData) as Record<string, unknown>;
  const char = (raw?.data ?? raw) as Record<string, unknown>;

  const hits = searchDefinitions(char, query);

  if (hits.length === 0) {
    return `No definition found matching "${query}" on this character. Try a partial name like "hunter" for Hunter's Mark.`;
  }

  if (hits.length > 3) {
    const list = hits.map((h, i) => `${i + 1}. [${h.type}] ${h.text.split("\n")[0]}`).join("\n");
    return `Found ${hits.length} matches for "${query}". Be more specific, or here are the matches:\n\n${list}`;
  }

  return hits.map(h => `[${h.type}]\n${h.text}`).join("\n\n===\n\n");
}

