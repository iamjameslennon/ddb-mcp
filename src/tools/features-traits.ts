/**
 * Class features and racial traits: normalization, filtering and formatting.
 * Pure — no I/O.
 *
 * Turns the /game-data/classes, /game-data/subclasses, /game-data/races and
 * optional-feature payloads into lists of `ClassFeatureEntry` and
 * `RacialTraitEntry`. The caller does the fetching and decides what a failed
 * request means.
 *
 * Text rule: base and subclass features show `summary`, optional features show
 * `snippet` (unless it holds an unresolved `{{` template); both go through
 * `stripHtml`, and a blank result falls back to the stripped `description`.
 * Racial traits (standard and optional) use the optional-feature rule.
 */
import { stripHtml, wrapUntrusted } from "../utils.js";

export type SourceRef = { sourceId: number };
export interface OptionalCollection {
  definitionData?: unknown[] | null;
  accessTypes?: Record<string, number> | null;
}
export type FeatureKind = "class" | "subclass" | "optional";

export interface ClassFeatureEntry {
  id: number;
  name: string;
  kind: FeatureKind;
  requiredLevel: number | null;
  displayOrder: number | null;
  text: string; // plain text, untruncated
  locked: boolean;
  classId: number;
  className: string;
  subclassId: number | null;
  subclassName: string | null;
  sources: SourceRef[]; // owning subclass's, else class's; an optional feature's own
  ownerSources: SourceRef[]; // owning subclass's, else class's (optional features too): decides the owner's edition
  isHomebrew: boolean; // class or subclass isHomebrew
}

const LOCKED_ACCESS_TYPE = 4;
const KIND_ORDER: Record<FeatureKind, number> = { class: 0, subclass: 1, optional: 2 };

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A record with a numeric `id` and string `name`, or null. */
function named(v: unknown): (Rec & { id: number; name: string }) | null {
  if (!isRec(v) || typeof v.id !== "number" || typeof v.name !== "string") return null;
  return v as Rec & { id: number; name: string };
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function sourcesOf(v: unknown): SourceRef[] {
  if (!Array.isArray(v)) return [];
  const out: SourceRef[] = [];
  for (const s of v) {
    if (isRec(s) && typeof s.sourceId === "number") out.push({ sourceId: s.sourceId });
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Cleaned text of a field: HTML stripped and trimmed; "" when blank or not a string. */
function cleaned(v: unknown): string {
  return stripHtml(str(v));
}

function baseText(f: Rec): string {
  return cleaned(f.summary) || cleaned(f.description);
}

function optionalText(f: Rec): string {
  const snippet = cleaned(f.snippet);
  return snippet !== "" && !snippet.includes("{{") ? snippet : cleaned(f.description);
}

export function buildClassFeatures(
  classes: unknown[],
  subclassesByClassId: ReadonlyMap<number, unknown[]>,
  optionalByClassId: ReadonlyMap<number, OptionalCollection>,
): ClassFeatureEntry[] {
  const out: ClassFeatureEntry[] = [];
  const seen = new Set<string>();
  // Base feature ids per class, for dropping subclass/optional repeats of them.
  const baseIds = new Map<number, Set<number>>();

  const push = (key: string, entry: ClassFeatureEntry): void => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };

  for (const raw of classes) {
    const cls = named(raw);
    if (!cls) continue;
    const ids = baseIds.get(cls.id) ?? new Set<number>();
    baseIds.set(cls.id, ids);
    const features = Array.isArray(cls.classFeatures) ? cls.classFeatures : [];
    for (const rawFeature of features) {
      const f = named(rawFeature);
      if (!f) continue;
      ids.add(f.id);
      push(`c:${cls.id}:${f.id}`, {
        id: f.id,
        name: f.name,
        kind: "class",
        requiredLevel: numOrNull(f.requiredLevel),
        displayOrder: numOrNull(f.displayOrder),
        text: baseText(f),
        locked: false,
        classId: cls.id,
        className: cls.name,
        subclassId: null,
        subclassName: null,
        sources: sourcesOf(cls.sources),
        ownerSources: sourcesOf(cls.sources),
        isHomebrew: cls.isHomebrew === true,
      });
    }
  }

  const classById = new Map<number, Rec & { id: number; name: string }>();
  for (const raw of classes) {
    const cls = named(raw);
    if (cls && !classById.has(cls.id)) classById.set(cls.id, cls);
  }

  for (const [classId, subclasses] of subclassesByClassId) {
    const cls = classById.get(classId);
    if (!cls || !Array.isArray(subclasses)) continue;
    const parentIds = baseIds.get(classId) ?? new Set<number>();
    for (const rawSub of subclasses) {
      const sub = named(rawSub);
      if (!sub) continue;
      const features = Array.isArray(sub.classFeatures) ? sub.classFeatures : [];
      for (const rawFeature of features) {
        const f = named(rawFeature);
        if (!f || parentIds.has(f.id)) continue;
        push(`s:${sub.id}:${f.id}`, {
          id: f.id,
          name: f.name,
          kind: "subclass",
          requiredLevel: numOrNull(f.requiredLevel),
          displayOrder: numOrNull(f.displayOrder),
          text: baseText(f),
          locked: false,
          classId,
          className: cls.name,
          subclassId: sub.id,
          subclassName: sub.name,
          sources: sourcesOf(sub.sources),
          ownerSources: sourcesOf(sub.sources),
          isHomebrew: cls.isHomebrew === true || sub.isHomebrew === true,
        });
      }
    }
  }

  for (const [classId, collection] of optionalByClassId) {
    const cls = classById.get(classId);
    if (!cls || !isRec(collection) || !Array.isArray(collection.definitionData)) continue;
    const parentIds = baseIds.get(classId) ?? new Set<number>();
    const access = isRec(collection.accessTypes) ? collection.accessTypes : {};
    for (const rawFeature of collection.definitionData) {
      const f = named(rawFeature);
      if (!f || parentIds.has(f.id)) continue;
      push(`o:${classId}:${f.id}`, {
        id: f.id,
        name: f.name,
        kind: "optional",
        requiredLevel: numOrNull(f.requiredLevel),
        displayOrder: numOrNull(f.displayOrder),
        text: optionalText(f),
        locked: access[String(f.id)] === LOCKED_ACCESS_TYPE,
        classId,
        className: cls.name,
        subclassId: null,
        subclassName: null,
        sources: sourcesOf(f.sources),
        ownerSources: sourcesOf(cls.sources),
        isHomebrew: cls.isHomebrew === true,
      });
    }
  }

  return sortEntries(out);
}

/** Null sorts last. */
function cmpNullable(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** className, classId, kind, subclassName, level, displayOrder, name, id, then subclassId (nulls last). */
export function compareClassFeatures(a: ClassFeatureEntry, b: ClassFeatureEntry): number {
  return (
    a.className.localeCompare(b.className) ||
    a.classId - b.classId ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    (a.subclassName ?? "").localeCompare(b.subclassName ?? "") ||
    cmpNullable(a.requiredLevel, b.requiredLevel) ||
    cmpNullable(a.displayOrder, b.displayOrder) ||
    a.name.localeCompare(b.name) ||
    a.id - b.id ||
    cmpNullable(a.subclassId, b.subclassId)
  );
}

function sortEntries(entries: ClassFeatureEntry[]): ClassFeatureEntry[] {
  return entries.sort(compareClassFeatures);
}

/**
 * The search filters as predicates: `nameMatches` is the feature-name filter
 * (none without a name), `passes` the class/subclass and level filters.
 */
export function classFeatureFilters(f: { name?: string; className?: string; level?: number }): {
  nameMatches?: (e: ClassFeatureEntry) => boolean;
  passes: (e: ClassFeatureEntry) => boolean;
} {
  const name = f.name?.toLowerCase();
  const cls = f.className?.toLowerCase();
  return {
    nameMatches: name === undefined ? undefined : (e) => e.name.toLowerCase().includes(name),
    passes: (e) =>
      (cls === undefined ||
        e.className.toLowerCase().includes(cls) ||
        (e.subclassName?.toLowerCase().includes(cls) ?? false)) &&
      (f.level === undefined || e.requiredLevel === f.level),
  };
}

/** Description part of a line: the locked marker, else the first 100 characters of text (plus "..." from 100 up), else "". */
function descriptionPart(e: { locked: boolean; text: string }): string {
  if (e.locked) return "*locked — not available to this account*";
  return `${e.text.slice(0, 100)}${e.text.length >= 100 ? "..." : ""}`;
}

/** `label` is the entry's edition tag (plus any book note), placed right after the name. */
export function formatClassFeatureLine(e: ClassFeatureEntry, label: string): string {
  let line = `- **${e.name}** ${label} — ${e.className}`;
  if (e.subclassName) line += ` (${e.subclassName})`;
  line += ` level ${e.requiredLevel ?? "?"}`;
  if (e.kind === "optional") line += ", optional";
  const desc = descriptionPart(e);
  if (desc) line += `\n  ${desc}`;
  return e.isHomebrew ? wrapUntrusted(line) : line;
}

export type TraitKind = "standard" | "optional";

export interface RacialTraitEntry {
  id: number;
  name: string;
  kind: TraitKind;
  requiredLevel: number | null;
  displayOrder: number | null;
  text: string; // plain text, untruncated
  locked: boolean;
  raceKey: string; // `${entityRaceTypeId}:${entityRaceId}` of the race it is listed under
  entityRaceId: number; // of that race
  speciesName: string; // race fullName
  baseRaceName: string;
  isSubRace: boolean;
  isLegacy: boolean;
  isHomebrew: boolean;
  sources: SourceRef[]; // the race's; an optional trait's own
  ownerSources: SourceRef[]; // the race's (optional traits too): decides the species' edition
}

const TRAIT_KIND_ORDER: Record<TraitKind, number> = { standard: 0, optional: 1 };

export function raceKeyOf(race: { entityRaceTypeId: number; entityRaceId: number }): string {
  return `${race.entityRaceTypeId}:${race.entityRaceId}`;
}

type RaceRec = Rec & { entityRaceId: number; entityRaceTypeId: number; fullName: string };

function raceRec(v: unknown): RaceRec | null {
  if (
    !isRec(v) ||
    typeof v.entityRaceId !== "number" ||
    typeof v.entityRaceTypeId !== "number" ||
    typeof v.fullName !== "string"
  ) {
    return null;
  }
  return v as RaceRec;
}

/** An optional collection keyed to a race not in `races` contributes nothing. */
export function buildRacialTraits(
  races: unknown[],
  optionalByRaceKey: ReadonlyMap<string, OptionalCollection>,
): RacialTraitEntry[] {
  const out: RacialTraitEntry[] = [];
  const seen = new Set<string>();
  // Standard trait ids per race, for dropping optional repeats of them.
  const standardIds = new Map<string, Set<number>>();
  const raceByKey = new Map<string, RaceRec>();

  const push = (key: string, entry: RacialTraitEntry): void => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };

  const entryFor = (
    race: RaceRec,
    f: Rec & { id: number; name: string },
    kind: TraitKind,
    text: string,
    locked: boolean,
    sources: SourceRef[],
  ): RacialTraitEntry => ({
    id: f.id,
    name: f.name,
    kind,
    requiredLevel: numOrNull(f.requiredLevel),
    displayOrder: numOrNull(f.displayOrder),
    text,
    locked,
    raceKey: raceKeyOf(race),
    entityRaceId: race.entityRaceId,
    speciesName: race.fullName,
    baseRaceName: str(race.baseRaceName),
    isSubRace: race.isSubRace === true,
    isLegacy: race.isLegacy === true,
    isHomebrew: race.isHomebrew === true,
    sources,
    ownerSources: sourcesOf(race.sources),
  });

  for (const raw of races) {
    const race = raceRec(raw);
    if (!race) continue;
    const key = raceKeyOf(race);
    if (!raceByKey.has(key)) raceByKey.set(key, race);
    const ids = standardIds.get(key) ?? new Set<number>();
    standardIds.set(key, ids);
    const traits = Array.isArray(race.racialTraits) ? race.racialTraits : [];
    for (const rawTrait of traits) {
      const f = isRec(rawTrait) ? named(rawTrait.definition) : null;
      if (!f) continue;
      ids.add(f.id);
      push(`s:${key}:${f.id}`, entryFor(race, f, "standard", optionalText(f), false, sourcesOf(race.sources)));
    }
  }

  for (const [key, collection] of optionalByRaceKey) {
    const race = raceByKey.get(key);
    if (!race || !isRec(collection) || !Array.isArray(collection.definitionData)) continue;
    const ownIds = standardIds.get(key) ?? new Set<number>();
    const access = isRec(collection.accessTypes) ? collection.accessTypes : {};
    for (const rawTrait of collection.definitionData) {
      const f = named(rawTrait);
      if (!f || ownIds.has(f.id)) continue;
      push(
        `o:${key}:${f.id}`,
        entryFor(race, f, "optional", optionalText(f), access[String(f.id)] === LOCKED_ACCESS_TYPE, sourcesOf(f.sources)),
      );
    }
  }

  return sortTraits(out);
}

/** speciesName, raceKey, kind, name, id. */
export function compareRacialTraits(a: RacialTraitEntry, b: RacialTraitEntry): number {
  return (
    a.speciesName.localeCompare(b.speciesName) ||
    a.raceKey.localeCompare(b.raceKey) ||
    TRAIT_KIND_ORDER[a.kind] - TRAIT_KIND_ORDER[b.kind] ||
    a.name.localeCompare(b.name) ||
    a.id - b.id
  );
}

function sortTraits(entries: RacialTraitEntry[]): RacialTraitEntry[] {
  return entries.sort(compareRacialTraits);
}

/**
 * The search filters as predicates: `nameMatches` is the trait-name filter
 * (none without a name), `passes` the species filter, which also matches a
 * subrace's base race.
 */
export function racialTraitFilters(f: { name?: string; raceName?: string }): {
  nameMatches?: (e: RacialTraitEntry) => boolean;
  passes: (e: RacialTraitEntry) => boolean;
} {
  const name = f.name?.toLowerCase();
  const race = f.raceName?.toLowerCase();
  return {
    nameMatches: name === undefined ? undefined : (e) => e.name.toLowerCase().includes(name),
    passes: (e) =>
      race === undefined ||
      e.speciesName.toLowerCase().includes(race) ||
      e.baseRaceName.toLowerCase().includes(race),
  };
}

/** `label` is the entry's edition tag (plus any book note), placed right after the name; it marks homebrew too. */
export function formatRacialTraitLine(e: RacialTraitEntry, label: string): string {
  let species = e.speciesName;
  if (e.isSubRace && e.baseRaceName !== "") species += ` — subrace of ${e.baseRaceName}`;
  let line = `- **${e.name}** ${label} *(${species})*`;
  if (e.kind === "optional") line += " *(optional)*";
  const desc = descriptionPart(e);
  if (desc) line += ` — ${desc}`;
  return e.isHomebrew ? wrapUntrusted(line) : line;
}
