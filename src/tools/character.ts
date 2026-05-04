import { sessionFetch, hasValidSession, getCobaltToken } from "../session-fetch.js";
import { TtlCache } from "../cache.js";
import { writeFileSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

// Cache character JSON for 60 s to avoid redundant API calls within a session.
const characterCache = new TtlCache<string>(60_000, 50);

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
  if (!hasValidSession()) return null;
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

export function parseCharacterData(raw: Record<string, unknown>): string {
  const char = (raw?.data ?? raw) as Record<string, unknown>;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const str = (v: unknown) => (v != null ? String(v) : "");
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const obj = (v: unknown): Record<string, unknown> =>
    v != null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>) : {};
  const signed = (n: number) => n >= 0 ? `+${n}` : `${n}`;
  const modOf = (score: number) => Math.floor((score - 10) / 2);
  const hasTag = (feat: Record<string, unknown>, tag: string): boolean =>
    arr<Record<string, unknown>>(obj(feat.definition).categories).some(c => c.tagName === tag);
  const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // Flatten all modifier sources into one array, keeping the source tag
  const modSources = ["race", "class", "background", "feat", "item", "condition"];
  const allMods = modSources.flatMap(src =>
    arr<Record<string, unknown>>(obj(char.modifiers)[src])
  );

  // ── Identity ──────────────────────────────────────────────────────────────
  const charName = str(char.name);
  const race = str(obj(char.race).fullName || obj(char.race).baseName);
  const classes = arr<Record<string, unknown>>(char.classes);
  const classLine = classes.map(c => {
    const def = obj(c.definition);
    const sub = obj(c.subclassDefinition);
    const lvl = num(c.level);
    return sub.name ? `${def.name} (${sub.name}) ${lvl}` : `${def.name} ${lvl}`;
  }).join(" / ");
  const totalLevel = classes.reduce((s, c) => s + num(c.level), 0);
  const background = str(obj(obj(char.background).definition).name);
  const xp = num(char.currentXp);

  // ── Ability Scores ────────────────────────────────────────────────────────
  const statNames = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
  const statKeys = ["strength","dexterity","constitution","intelligence","wisdom","charisma"];
  const baseStats = arr<Record<string, unknown>>(char.stats);
  const bonusStats = arr<Record<string, unknown>>(char.bonusStats);
  const overrideStats = arr<Record<string, unknown>>(char.overrideStats);

  const scoreBonuses: Record<number, number> = {};
  for (const m of allMods) {
    if (m.type === "bonus" && typeof m.subType === "string" && m.subType.endsWith("-score")) {
      const idx = statKeys.indexOf(m.subType.replace("-score", ""));
      if (idx >= 0) scoreBonuses[idx + 1] = (scoreBonuses[idx + 1] ?? 0) + num(m.fixedValue);
    }
  }

  const statTotals = statNames.map((_, i) => {
    const id = i + 1;
    const base = baseStats.find(s => num(s.id) === id);
    const bonus = bonusStats.find(s => num(s.id) === id);
    const override = overrideStats.find(s => num(s.id) === id);
    const baseVal = num(base?.value ?? 0);
    const bonusVal = num(bonus?.value ?? 0);
    const overrideVal = override?.value != null ? num(override.value) : null;
    return overrideVal != null ? overrideVal : baseVal + bonusVal + (scoreBonuses[id] ?? 0);
  });
  const statMods = statTotals.map(modOf);
  const abilityScoreDisplay = statNames.map((n, i) => `${n} ${statTotals[i]} (${signed(statMods[i])})`);

  // ── Proficiency Bonus ─────────────────────────────────────────────────────
  const profBonus = Math.floor((totalLevel - 1) / 4) + 2;

  // ── Template resolver ─────────────────────────────────────────────────────
  const resolveTemplates = (text: string): string =>
    text
      .replace(/\{\{proficiency#signed\}\}/g, signed(profBonus))
      .replace(/\{\{proficiency\}\}/g, String(profBonus))
      .replace(/\{\{level\}\}/g, String(totalLevel))
      .replace(/\{\{[^}]+\}\}/g, "?");

  // ── Hit Points ────────────────────────────────────────────────────────────
  // baseHitPoints does NOT include the CON modifier — must add conMod × level.
  const conMod = statMods[2];
  const maxHp = num(char.baseHitPoints) + num(char.bonusHitPoints) + (conMod * totalLevel);
  const currentHp = maxHp - num(char.removedHitPoints);
  const tempHp = num(char.temporaryHitPoints);

  // ── Hit Dice ──────────────────────────────────────────────────────────────
  const hitDiceLines = classes.map(c => {
    const die = num(obj(c.definition).hitDice);
    const lvl = num(c.level);
    const used = num(c.hitDiceUsed);
    return `${lvl}d${die} (${lvl - used} remaining)`;
  });

  // ── Speed ─────────────────────────────────────────────────────────────────
  const weightSpeeds = obj(obj(obj(char.race).weightSpeeds).normal);
  // "set" modifiers on innate-speed-walking override the base race speed (e.g. Wood Elf +5)
  const walkOverride = allMods
    .filter(m => m.type === "set" && m.subType === "innate-speed-walking" && num(m.value ?? m.fixedValue) > 0)
    .reduce((max, m) => Math.max(max, num(m.value ?? m.fixedValue)), 0);
  const walkSpeed = walkOverride || num(weightSpeeds.walk) || 30;
  const speedParts: string[] = [];
  speedParts.push(`${walkSpeed} ft.`);
  if (num(weightSpeeds.fly) > 0) speedParts.push(`fly ${num(weightSpeeds.fly)} ft.`);
  if (num(weightSpeeds.swim) > 0) speedParts.push(`swim ${num(weightSpeeds.swim)} ft.`);
  if (num(weightSpeeds.climb) > 0) speedParts.push(`climb ${num(weightSpeeds.climb)} ft.`);
  if (num(weightSpeeds.burrow) > 0) speedParts.push(`burrow ${num(weightSpeeds.burrow)} ft.`);

  // ── Initiative ────────────────────────────────────────────────────────────
  const dexMod = statMods[1];
  // Jack of All Trades (2014 rules) explicitly grants half-proficiency to initiative.
  // The 2014 API stores a separate "initiative" half-proficiency modifier; 2024 only has "ability-checks".
  const joatInitiative = allMods.some(m => m.type === "half-proficiency" && m.subType === "initiative");
  const initiativeBonus = allMods
    .filter(m => m.subType === "initiative" && m.type === "bonus")
    .reduce((s, m) => {
      // bonusTypes [1] means the bonus value is the proficiency bonus, not a fixed number
      const usesProfBonus = arr<number>(m.bonusTypes).includes(1) && (m.fixedValue == null && m.value == null);
      return s + (usesProfBonus ? profBonus : num(m.fixedValue ?? m.value));
    }, 0);
  const initiative = dexMod + initiativeBonus + (joatInitiative ? Math.floor(profBonus / 2) : 0);

  // ── Armor Class ───────────────────────────────────────────────────────────
  // armorTypeId: 1=light, 2=medium, 3=heavy, 4=shield
  const inventory = arr<Record<string, unknown>>(char.inventory);
  const equippedArmorPieces = inventory.filter(i =>
    i.equipped === true && str(obj(i.definition).filterType) === "Armor"
  );
  const shield = equippedArmorPieces.find(i => num(obj(i.definition).armorTypeId) === 4);
  // If multiple body armors are equipped (e.g. party loot), pick whichever yields the best effective AC.
  const bodyArmorCandidates = equippedArmorPieces.filter(i => num(obj(i.definition).armorTypeId) !== 4);
  const effectiveBodyAc = (i: Record<string, unknown>) => {
    const def = obj(i.definition);
    const baseAc = num(def.armorClass);
    const typeId = num(def.armorTypeId);
    if (typeId === 1) return baseAc + dexMod;
    if (typeId === 2) return baseAc + Math.min(dexMod, 2);
    return baseAc;
  };
  const bodyArmor = bodyArmorCandidates.reduce<Record<string, unknown> | null>(
    (best, i) => best === null || effectiveBodyAc(i) > effectiveBodyAc(best) ? i : best, null
  );
  let ac: number;
  if (bodyArmor) {
    ac = effectiveBodyAc(bodyArmor);
  } else {
    // Unarmored Defense (Barbarian = 10+DEX+CON, Monk = 10+DEX+WIS)
    const unarmoredMod = allMods.find(m => m.subType === "unarmored-armor-class");
    if (unarmoredMod) {
      const extraStatId = num(unarmoredMod.statId); // 3=CON, 5=WIS
      const extraMod = extraStatId > 0 ? statMods[extraStatId - 1] : 0;
      ac = 10 + dexMod + extraMod;
    } else {
      ac = 10 + dexMod;
    }
  }
  if (shield) ac += num(obj(shield.definition).armorClass);
  // Add any AC bonus modifiers (e.g. shield of faith, ring of protection)
  const acBonus = allMods
    .filter(m => m.subType === "armor-class" && m.type === "bonus")
    .reduce((s, m) => s + num(m.fixedValue ?? m.value), 0);
  ac += acBonus;

  // ── Saving Throws ─────────────────────────────────────────────────────────
  const saveProfSubTypes = new Set(
    allMods.filter(m => m.type === "proficiency" && str(m.subType).includes("saving-throws"))
      .map(m => str(m.subType))
  );
  const savingThrows = statKeys.map((key, i) => {
    const isProficient = saveProfSubTypes.has(`${key}-saving-throws`);
    const total = statMods[i] + (isProficient ? profBonus : 0);
    return `${statNames[i]} ${signed(total)}${isProficient ? "*" : ""}`;
  });

  // ── Skills ────────────────────────────────────────────────────────────────
  const SKILLS: Array<[string, number]> = [
    ["Acrobatics", 1], ["Animal Handling", 4], ["Arcana", 3], ["Athletics", 0],
    ["Deception", 5], ["History", 3], ["Insight", 4], ["Intimidation", 5],
    ["Investigation", 3], ["Medicine", 4], ["Nature", 3], ["Perception", 4],
    ["Performance", 5], ["Persuasion", 5], ["Religion", 3], ["Sleight of Hand", 1],
    ["Stealth", 1], ["Survival", 4],
  ];
  const skillProfSubTypes = new Set(
    allMods.filter(m => m.type === "proficiency").map(m => str(m.subType))
  );
  const skillExpertiseSubTypes = new Set(
    allMods.filter(m => m.type === "expertise").map(m => str(m.subType))
  );
  // half-proficiency (e.g. Bard's Jack of All Trades applies to all ability checks)
  const hasJackOfAllTrades = allMods.some(
    m => m.type === "half-proficiency" && m.subType === "ability-checks"
  );
  const skillHalfProfSubTypes = new Set(
    allMods.filter(m => m.type === "half-proficiency" && m.subType !== "ability-checks")
      .map(m => str(m.subType))
  );
  // Compute skill bonuses once; reuse for both the display lines and passive senses.
  const skillBonuses = SKILLS.map(([skillName, statIdx]) => {
    const slug = skillName.toLowerCase().replace(/ /g, "-").replace(/'/g, "");
    const isProficient = skillProfSubTypes.has(slug);
    const isExpertise = skillExpertiseSubTypes.has(slug);
    const isHalf = !isProficient && (skillHalfProfSubTypes.has(slug) || hasJackOfAllTrades);
    let bonus = statMods[statIdx];
    if (isExpertise) bonus += profBonus * 2;
    else if (isProficient) bonus += profBonus;
    else if (isHalf) bonus += Math.floor(profBonus / 2);
    return { bonus, isProficient, isExpertise };
  });
  const skillLines = SKILLS.map(([skillName, statIdx], i) => {
    const { bonus, isProficient, isExpertise } = skillBonuses[i];
    const marker = isExpertise ? " **" : isProficient ? " *" : "";
    const statLabel = statNames[statIdx];
    return `  ${(skillName + ` (${statLabel})`).padEnd(22)} ${signed(bonus)}${marker}`;
  });

  // ── Senses ────────────────────────────────────────────────────────────────
  const perceptionIdx = SKILLS.findIndex(([n]) => n === "Perception");
  const investigationIdx = SKILLS.findIndex(([n]) => n === "Investigation");
  const insightIdx = SKILLS.findIndex(([n]) => n === "Insight");
  const passivePerception = 10 + skillBonuses[perceptionIdx].bonus;
  const passiveInvestigation = 10 + skillBonuses[investigationIdx].bonus;
  const passiveInsight = 10 + skillBonuses[insightIdx].bonus;
  const specialSenses = allMods
    .filter(m => m.type === "sense")
    .map(m => `${capitalize(str(m.subType))} ${num(m.value)} ft.`);

  // ── Proficiencies ─────────────────────────────────────────────────────────
  const armorProfMap: Record<string, string> = {
    "light-armor": "Light Armor", "medium-armor": "Medium Armor",
    "heavy-armor": "Heavy Armor", "shields": "Shields",
  };
  const weaponProfMap: Record<string, string> = {
    "simple-weapons": "Simple Weapons", "martial-weapons": "Martial Weapons",
  };
  // Placeholder subType values that are unresolved character-builder selections — discard them.
  const isProfPlaceholder = (sub: string) =>
    sub.toLowerCase().startsWith("choose") || sub.toLowerCase() === "self";
  // Specific weapon type slugs — route to Weapons, not Tools.
  const isWeaponSlug = (sub: string) =>
    /sword|axe|bow|crossbow|dagger|dart|sling|blowgun|staff|spear|club|mace|hammer|flail|lance|pike|rapier|scimitar|sickle|whip|maul|halberd|glaive|javelin|trident|handaxe|net|morningstar/.test(sub);
  const armorProfs: string[] = [];
  const weaponProfs: string[] = [];
  const toolProfs: string[] = [];
  const languages: string[] = [];
  for (const m of allMods) {
    const sub = str(m.subType);
    if (isProfPlaceholder(sub)) continue;
    if (m.type === "proficiency") {
      if (armorProfMap[sub]) armorProfs.push(armorProfMap[sub]);
      else if (weaponProfMap[sub]) weaponProfs.push(weaponProfMap[sub]);
      else if (sub.includes("saving-throws") || sub.includes("-skill") ||
               SKILLS.some(([n]) => n.toLowerCase().replace(/ /g, "-").replace(/'/g, "") === sub)) {
        // skill/save prof — handled elsewhere
      } else if (!sub.includes("-score") && sub.length > 0 &&
                 !statKeys.some(k => sub.startsWith(k))) {
        if (isWeaponSlug(sub)) {
          weaponProfs.push(capitalize(sub.replace(/-/g, " ")));
        } else {
          toolProfs.push(capitalize(sub.replace(/-/g, " ")));
        }
      }
    } else if (m.type === "language") {
      languages.push(capitalize(sub.replace(/-/g, " ")));
    }
  }

  // ── Defenses & Conditions ─────────────────────────────────────────────────
  const resistances = [...new Set(allMods.filter(m => m.type === "resistance").map(m => capitalize(str(m.subType))))];
  const immunities = [...new Set(allMods.filter(m => m.type === "immunity").map(m => capitalize(str(m.subType))))];
  const vulnerabilities = [...new Set(allMods.filter(m => m.type === "vulnerability").map(m => capitalize(str(m.subType))))];
  const conditions = arr<Record<string, unknown>>(char.conditions).map(c => str(c.id));

  // ── Feats ─────────────────────────────────────────────────────────────────
  // DDB stores some non-feat features in the feats array tagged __DISGUISE_FEAT.
  const allFeats = arr<Record<string, unknown>>(char.feats);
  const realFeats = allFeats.filter(f => !hasTag(f, "__DISGUISE_FEAT"));
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
  const bgDef = obj(obj(char.background).definition);
  const bgFeatureName = str(bgDef.featureName);
  const bgFeatureDesc = bgDef.featureDescription
    ? resolveTemplates(stripHtml(str(bgDef.featureDescription))).slice(0, 300)
    : "";

  // ── Actions / Bonus Actions / Reactions / Limited Use ─────────────────────
  // activation.activationType: 1=action, 2=bonus action, 3=reaction, 8=special (skip)
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

  // activationType 3 = bonus action in class actions (not a reaction — reactions aren't in the array)
  // activationType 1 = action (weapon masteries — skip, shown in ACTIONS already)
  // activationType 8 = special/passive — skip
  const bonusActions = [
    ...allActions.filter(a => activationType(a) === 3).map(a => `• ${str(a.name)}`),
    ...bonusActionSpells,
  ];
  // Reactions: Opportunity Attack is universal, plus any reaction-cast spells
  const reactions: string[] = ["• Opportunity Attack", ...reactionSpells];
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
    const typeName = str(def.type).toLowerCase().replace(/ /g, "-");
    return (catId === 1 && weaponProfSlugs.has("simple-weapons")) ||
           (catId === 2 && weaponProfSlugs.has("martial-weapons")) ||
           weaponProfSlugs.has(typeName);
  };

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

    // Ability modifier for attack/damage
    const usesDex = isRanged || (isFinesse && dexMod > statMods[0]);
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
    if (!def.canCastSpells) continue;
    const abilityId = num(def.spellCastingAbilityId);
    if (!abilityId) continue;
    const abilityMod = statMods[abilityId - 1];
    const spellAttack = abilityMod + profBonus;
    const saveDc = 8 + abilityMod + profBonus;
    spellcastingLines.push(
      `  ${str(def.name)}: ${statNames[abilityId - 1]}  Spell Attack: ${signed(spellAttack)}  Save DC: ${saveDc}`
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
  for (const cs of classSpells) {
    const classEntry = classes.find(c => c.id === cs.characterClassId);
    const className = str(obj(classEntry?.definition ?? {}).name);
    const isSpellbook = className === "Wizard";
    const allSpells = arr<Record<string, unknown>>(cs.spells);
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
  }
  const spellsObj = obj(char.spells);
  const sourceLabels: Record<string, string> = {
    race: "Racial Trait", class: "Class Feature", background: "Background", feat: "Feat", item: "Item",
  };
  for (const [key, label] of Object.entries(sourceLabels)) {
    const spellList = arr<Record<string, unknown>>(spellsObj[key]);
    if (!spellList.length) continue;
    const names = spellList
      .map(s => {
        const def = obj(s.definition);
        const n = str(def.name);
        return n ? (num(def.level) === 0 ? n : `${n} (L${num(def.level)})`) : "";
      })
      .filter(n => n.length > 0);
    if (names.length) spellSections.push(`  From ${label}: ${names.join(", ")}`);
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

  // ── Death Saves ───────────────────────────────────────────────────────────
  const deathSaves = obj(char.deathSaves);
  const dsSucc = num(deathSaves.successCount);
  const dsFail = num(deathSaves.failCount);

  // ── Build output ──────────────────────────────────────────────────────────
  const lines: string[] = [
    `═══════════════════════════════════════`,
    `  ${charName}`,
    `  ${race} | ${classLine} | Level ${totalLevel}`,
    `  Background: ${background || "—"} | XP: ${xp}`,
    `  Inspiration: ${char.inspiration ? "Yes" : "No"}`,
    `═══════════════════════════════════════`,
    ``,
    `HP: ${currentHp}/${maxHp}   Temp HP: ${tempHp || "—"}   Prof Bonus: ${signed(profBonus)}`,
    `Hit Dice: ${hitDiceLines.join(" / ")}`,
    `AC: ${ac}   Initiative: ${signed(initiative)}   Speed: ${speedParts.join(", ")}`,
    `Death Saves: Successes ${dsSucc}/3   Failures ${dsFail}/3`,
    ``,
    `ABILITY SCORES`,
    `  ${abilityScoreDisplay.join("  ")}`,
    ``,
    `SAVING THROWS`,
    `  ${savingThrows.join("   ")}`,
    `  (* proficient)`,
    ``,
    `SKILLS`,
    ...skillLines,
    `  (* proficient, ** expertise)`,
    ``,
    `SENSES`,
    `  Passive Perception: ${passivePerception}   Passive Investigation: ${passiveInvestigation}   Passive Insight: ${passiveInsight}`,
    ...(specialSenses.length ? [`  ${specialSenses.join(", ")}`] : []),
    ``,
    `PROFICIENCIES & TRAINING`,
    `  Armor: ${armorProfs.length ? [...new Set(armorProfs)].join(", ") : "None"}`,
    `  Weapons: ${weaponProfs.length ? [...new Set(weaponProfs)].join(", ") : "None"}`,
    `  Tools: ${toolProfs.length ? [...new Set(toolProfs)].join(", ") : "None"}`,
    `  Languages: ${languages.length ? [...new Set(languages)].join(", ") : "None"}`,
    ``,
    `DEFENSES`,
    `  Resistances: ${resistances.length ? resistances.join(", ") : "(none)"}`,
    `  Immunities: ${immunities.length ? immunities.join(", ") : "(none)"}`,
    `  Vulnerabilities: ${vulnerabilities.length ? vulnerabilities.join(", ") : "(none)"}`,
    `CONDITIONS: ${conditions.length ? conditions.join(", ") : "(none)"}`,
    ``,
    `FEATS (${realFeats.length})`,
    ...(featLines.length ? featLines : ["  (none)"]),
    ``,
  ];

  if (disguisedFeats.length) {
    lines.push(
      `OTHER FEATURES (stored as feats in API but NOT player-chosen feats)`,
      ...disguisedFeats.map(f => `• ${str(obj(f.definition).name)}`),
      ``
    );
  }

  lines.push(
    `CLASS FEATURES`,
    ...classFeatureLines,
    ``,
    `RACIAL TRAITS`,
    ...racialTraitLines,
    ``,
  );

  if (bgFeatureName) {
    const descSnippet = bgFeatureDesc
      ? `${bgFeatureDesc}${bgFeatureDesc.length >= 300 ? "…" : ""}` : "";
    lines.push(
      `BACKGROUND FEATURE`,
      `  ${bgFeatureName}${descSnippet ? `: ${descSnippet}` : ""}`,
      ``
    );
  }

  lines.push(
    `ACTIONS`,
    ...(weaponAttacks.length ? weaponAttacks : ["  (none)"]),
    ``,
    `BONUS ACTIONS`,
    ...(bonusActions.length ? bonusActions : ["  (none)"]),
    ``,
    `REACTIONS`,
    ...(reactions.length ? reactions : ["  (none)"]),
    ``,
  );

  if (limitedUseFeatures.length) {
    lines.push(`LIMITED USE`, ...limitedUseFeatures, ``);
  }

  if (spellcastingLines.length) {
    lines.push(`SPELLCASTING`, ...spellcastingLines, ``);
  }

  if (slotLines.length) {
    lines.push(`SPELL SLOTS`, ...slotLines, ``);
  }

  if (spellSections.length) {
    lines.push(`SPELLS`, ...spellSections, ``);
  }

  if (equippedNonWeapons.length) {
    lines.push(`EQUIPPED`, ...equippedNonWeapons.map(e => `  ${e}`), ``);
  }

  if (inventoryLine) {
    lines.push(`INVENTORY`, `  ${inventoryLine}`, ``);
  }

  lines.push(
    `ATTUNEMENT: ${attuned}/3 slots used`,
    ``,
    `CURRENCY: ${currencyLine}`,
  );

  return lines.join("\n");
}

export async function parseCharacter(
  characterId: string
): Promise<string> {
  const jsonData = await getCharacter(characterId);
  const raw = JSON.parse(jsonData) as Record<string, unknown>;
  return parseCharacterData(raw);
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

  const url = `https://character-service.dndbeyond.com/character/v5/character/${characterId}?includeCustomItems=true`;

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
  const filename = `${charName.replace(/\s+/g, "-").toLowerCase()}-${characterId}.json`;
  const defaultPath = join(homedir(), "Downloads", filename);

  let savePath: string;
  if (outputPath) {
    // Resolve to an absolute path and ensure it stays within the user's home directory.
    const resolved = join(resolve(outputPath));
    if (!resolved.startsWith(homedir())) {
      throw new Error(`Output path must be within your home directory (${homedir()}).`);
    }
    savePath = resolved;
  } else {
    savePath = defaultPath;
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

function stripHtmlFull(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&#\d+;/g, (m) => String.fromCharCode(parseInt(m.slice(2, -1))))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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

  return hits.map(h => `[${h.type}]\n${h.text}`).join("\n\n===\n\n");
}

