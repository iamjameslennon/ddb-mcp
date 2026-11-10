/**
 * monster.ts — DDB monster service tools
 *
 * API host: monster-service.dndbeyond.com
 * Auth: Bearer cobalt token (same as character service). Logged out, the
 * service is asked with no credentials at all (anonymousFetch): it answers
 * free content, and its accessType map marks the rest locked (4).
 * Envelope: { accessType, pagination, data } for list; { accessType, data } for single
 *
 * Game config (CR values, type names, sources, etc.) comes from
 * ../game-config.ts.
 */

import {
  captureSession, SessionChangedError, type SessionSnapshot,
} from "../session-fetch.js";
import { getSourceIndex, type GameConfig } from "../game-config.js";
import {
  classifyEdition, selectByEdition, lookupByName, monsterTiebreak,
  normalizeName, isEdition, rulesLine, renameLine,
  isLockedReason, availableElsewhereHint,
  loggedOutReason, LOGGED_OUT_RESTRICTED_NOTE, NOT_LOGGED_IN_SUFFIX,
  HOMEBREW_INFO,
  type EditionInfo, type RulesEdition, type RulesLineReason, type SourceIndex,
} from "../edition.js";
import {
  resolveSourceIds, isHomebrewSource, sourceLabel, sourceSlug, unknownSourceError, withSourceCaveat,
} from "../source-filter.js";
import { wrapUntrusted, stripHtmlRich } from "../utils.js";
import {
  o5GetMonster, o5GetMonsterStats, o5MonsterInEdition, type MonsterStatsResult,
} from "../open5e.js";
import {
  askerNow, configFor, fetchCandidates, fetchMonsterDetail, isRestricted, isLockedIn,
  fetchMonsterPages, MAX_FILTER_SCAN, availableSourcesFor, sizeName, crDisplay, namedCandidates, monsterTwin, clearMonsterCache,
  GameConfigUnavailableError, isExpectedOutage,
  type DdbMonster, type MonsterSingleResponse, type Asker,
} from "./monster-service.js";
import {
  searchMonsters, searchMonstersSection, HOMEBREW_LOGIN_REQUIRED, HOMEBREW_UNREACHABLE,
  type MonsterSearchParams,
} from "./monster-search.js";
import { sourceNoteFor } from "./edition-search.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MOVEMENT_NAMES: Record<number, string> = {
  1: "walk", 2: "burrow", 3: "climb", 4: "fly", 5: "swim",
};

const STAT_NAMES: Record<number, string> = {
  1: "STR", 2: "DEX", 3: "CON", 4: "INT", 5: "WIS", 6: "CHA",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Stat-block prose (traits, actions, reactions…): like stripHtml, but keeps
 * DDB's <strong> feature names ("Bite.", "Multiattack.") as Markdown bold.
 * Exported for tests.
 */
export function statBlockText(html: string | null | undefined): string {
  if (!html) return "";
  return stripHtmlRich(boldSpans(html));
}

const BOLD_TAGS = ["strong", "b"] as const;

/** [A-Za-z0-9_], as a regex \b sees it. NaN (past the end) is not a word character. */
function isWordChar(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

/** `name` (lowercase ASCII) at `at`, ASCII case-insensitive, followed by a word boundary. */
function tagNameAt(html: string, at: number, name: string): boolean {
  if (at + name.length > html.length) return false;
  for (let i = 0; i < name.length; i++) {
    // `| 0x20` lowercases A–Z; no other code unit maps onto a lowercase letter.
    if ((html.charCodeAt(at + i) | 0x20) !== name.charCodeAt(i)) return false;
  }
  return !isWordChar(html.charCodeAt(at + name.length));
}

/**
 * Each <strong>/<b> span as Markdown bold, by an indexOf scan: what
 * `html.replace(/<(strong|b)\b[^<>]*>((?:(?!<\/?\1\b)[\s\S])*)<\/\1>/gi, …)`
 * did, without its backtracking (a single span over ~8 MB overflowed V8's
 * backtrack stack and the lookup fell back to Open5e). A span's body runs up to
 * the next tag of its own name, opening or closing; the span matches only if
 * that tag is exactly `</name>`. So an unclosed tag stays as it is, and a <b>
 * nested in a <strong> keeps the outer bold. Linear: each attempt's body scan
 * ends at the next tag of the same name.
 */
function boldSpans(html: string): string {
  let out = "";
  let last = 0;
  let open = html.indexOf("<");
  while (open !== -1) {
    const end = boldSpanEnd(html, open);
    if (end === null) {
      open = html.indexOf("<", open + 1);
      continue;
    }
    out += html.slice(last, open) + boldInner(html.slice(end.bodyStart, end.bodyEnd));
    last = end.next;
    open = html.indexOf("<", last);
  }
  return last === 0 ? html : out + html.slice(last);
}

/** The span opening at `open` (a "<"), or null when no span matches there. */
function boldSpanEnd(html: string, open: number): { bodyStart: number; bodyEnd: number; next: number } | null {
  const name = BOLD_TAGS.find(n => tagNameAt(html, open + 1, n));
  if (!name) return null;
  // The opening tag's attributes: anything but "<" up to its ">".
  let q = open + 1 + name.length;
  while (q < html.length && html[q] !== ">" && html[q] !== "<") q++;
  if (html[q] !== ">") return null;
  const bodyStart = q + 1;
  for (let r = html.indexOf("<", bodyStart); r !== -1; r = html.indexOf("<", r + 1)) {
    if (html[r + 1] === "/" && tagNameAt(html, r + 2, name)) {
      const close = r + 2 + name.length;
      return html[close] === ">" ? { bodyStart, bodyEnd: r, next: close + 1 } : null;
    }
    if (tagNameAt(html, r + 1, name)) return null;
  }
  return null;
}

/** Wrap a tag's contents in Markdown bold, keeping its surrounding whitespace outside the markers. */
function boldInner(inner: string): string {
  if (!inner.replace(/<[^<>]+>/g, "").trim()) return inner;
  const lead = inner.length - inner.trimStart().length;
  const end = inner.trimEnd().length;
  return `${inner.slice(0, lead)}**${inner.slice(lead, end)}**${inner.slice(end)}`;
}

function abilityMod(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/**
 * The Languages line. 2014 entries carry free text in languageDescription;
 * 2024 entries leave it null and list language IDs (resolved through the game
 * config) with per-language notes such as telepathy range. languageNote holds
 * extra text — on some entries the whole line ("Understands Common … but
 * can't speak"), on others a repeat of languageDescription, which is dropped.
 */
function languagesLine(m: DdbMonster, config: GameConfig | null): string {
  const description = stripHtmlRich(m.languageDescription);
  const listed = description || (m.languages ?? [])
    .map(l => {
      const name = stripHtmlRich(config?.languages?.find(c => c.id === l.languageId)?.name) || `Language #${l.languageId}`;
      const notes = stripHtmlRich(l.notes);
      return notes ? `${name} ${notes}` : name;
    })
    .join(", ");
  const note = stripHtmlRich(m.languageNote);
  const extra = note && note.toLowerCase() !== listed.toLowerCase() ? note : "";
  return [listed, extra].filter(Boolean).join(", ");
}

// ── Formatter ─────────────────────────────────────────────────────────────────

interface StatBlockExtras {
  reason?: RulesLineReason;
  renamed?: { name2014: string; name2024: string };
  /** A source note (sourceNoteFor with the shown entry: lookupSourceNote). */
  note?: string | null;
  /** An availableElsewhereHint() line. */
  hint?: string | null;
  /** Overrides the entry's own classification (source: "homebrew"). */
  info?: EditionInfo;
  /** Asked anonymously: a restricted block says to log in, not that content needs owning. */
  loggedOut?: boolean;
}

function formatStatBlock(
  m: DdbMonster, accessType: number, config: GameConfig | null, index: SourceIndex, extras: StatBlockExtras = {},
): string {
  const crEntry = config?.challengeRatings.find(cr => cr.id === m.challengeRatingId);
  const crStr = crEntry ? crDisplay(crEntry.value) : `(id:${m.challengeRatingId})`;
  const xpStr = crEntry?.xp ? ` (${crEntry.xp.toLocaleString()} XP)` : "";
  const typeName = config?.monsterTypes.find(t => t.id === m.typeId)?.name ?? `type ${m.typeId}`;
  const size = sizeName(config, m.sizeId) ?? "Unknown size";
  const alignment = config?.alignments.find(a => a.id === m.alignmentId)?.name ?? "Unaligned";

  const lines: string[] = [];
  lines.push(`# ${m.name}`);
  lines.push(rulesLine(extras.info ?? classifyEdition(m, index), { reason: extras.reason }));
  if (extras.renamed) lines.push(renameLine(extras.renamed.name2014, extras.renamed.name2024));
  if (extras.note) lines.push(extras.note);
  if (extras.hint) lines.push(extras.hint);
  lines.push(`*${size} ${typeName}, ${alignment}*`);
  // Name the book (as ddb_search_monsters does) so same-named 2014/2024 blocks are distinguishable.
  if (m.sourceId) lines.push(`**Source** ${sourceLabel(index, m.sourceId)}`);
  lines.push("");
  // accessType 4 = restricted — basic stats returned but ability scores and actions may be empty.
  const restricted = accessType === 4 && (!m.stats?.length || !m.actionsDescription);
  // monster-service zeroes AC, HP and passive Perception on a locked block: show a dash, not the zero.
  lines.push(restricted && !m.armorClass
    ? "**Armor Class** —"
    : `**Armor Class** ${m.armorClass}${m.armorClassDescription ? " " + m.armorClassDescription.trim() : ""}`);
  lines.push(restricted && !m.averageHitPoints
    ? "**Hit Points** —"
    : `**Hit Points** ${m.averageHitPoints}${m.hitPointDice?.diceString ? " (" + m.hitPointDice.diceString + ")" : ""}`);

  if (m.movements?.length) {
    const speeds = m.movements.map(mv => {
      const name = MOVEMENT_NAMES[mv.movementId] ?? "walk";
      return name === "walk" ? `${mv.speed} ft.` : `${name} ${mv.speed} ft.`;
    });
    lines.push(`**Speed** ${speeds.join(", ")}`);
  }

  if (m.stats?.length) {
    lines.push("");
    const statLine = [...m.stats]
      .sort((a, b) => a.statId - b.statId)
      .map(s => `**${STAT_NAMES[s.statId] ?? s.statId}** ${s.value} (${abilityMod(s.value)})`)
      .join(" | ");
    lines.push(statLine);
  }

  lines.push("");

  if (m.savingThrows?.length) {
    // bonusModifier is null in the live API — derive from stat mod + CR proficiency bonus.
    const profBonus = crEntry?.proficiencyBonus ?? 2;
    const statMap = new Map(m.stats?.map(s => [s.statId, s.value]) ?? []);
    const saves = m.savingThrows
      .map(s => {
        const bonus = s.bonusModifier != null
          ? s.bonusModifier
          : Math.floor(((statMap.get(s.statId) ?? 10) - 10) / 2) + profBonus;
        const sign = bonus >= 0 ? "+" : "";
        return `${STAT_NAMES[s.statId] ?? s.statId} ${sign}${bonus}`;
      })
      .join(", ");
    lines.push(`**Saving Throws** ${saves}`);
  }

  if (m.skillsHtml) {
    lines.push(`**Skills** ${stripHtmlRich(m.skillsHtml)}`);
  }

  if (m.senses?.length) {
    const senseStrs = m.senses.map(s => {
      const name = config?.senses.find(cs => cs.id === s.senseId)?.name ?? `sense ${s.senseId}`;
      return `${name} ${s.notes}`;
    });
    if (!(restricted && !m.passivePerception)) senseStrs.push(`passive Perception ${m.passivePerception}`);
    lines.push(`**Senses** ${senseStrs.join(", ")}`);
  } else if (!(restricted && !m.passivePerception)) {
    lines.push(`**Senses** passive Perception ${m.passivePerception}`);
  }

  const languages = languagesLine(m, config);
  if (languages) {
    lines.push(`**Languages** ${languages}`);
  }

  lines.push(`**Challenge** ${crStr}${xpStr}`);

  if (m.specialTraitsDescription) {
    lines.push("\n---\n");
    lines.push(statBlockText(m.specialTraitsDescription));
  }
  if (m.actionsDescription) {
    lines.push("\n## Actions\n");
    lines.push(statBlockText(m.actionsDescription));
  }
  if (m.bonusActionsDescription) {
    lines.push("\n## Bonus Actions\n");
    lines.push(statBlockText(m.bonusActionsDescription));
  }
  if (m.reactionsDescription) {
    lines.push("\n## Reactions\n");
    lines.push(statBlockText(m.reactionsDescription));
  }
  if (m.legendaryActionsDescription) {
    lines.push("\n## Legendary Actions\n");
    lines.push(statBlockText(m.legendaryActionsDescription));
  }
  if (m.mythicActionsDescription) {
    lines.push("\n## Mythic Actions\n");
    lines.push(statBlockText(m.mythicActionsDescription));
  }

  if (restricted) {
    lines.push(extras.loggedOut
      ? `\n---\n${LOGGED_OUT_RESTRICTED_NOTE}`
      : "\n---\n*⚠️ Full stat block requires ownership of this content on D&D Beyond. Ability scores and actions may be missing.*");
  }

  return lines.join("\n");
}

// ── Exported tool functions ───────────────────────────────────────────────────

export async function getMonster(
  monsterName: string,
  opts: { source?: string; rulesEdition?: RulesEdition } = {},
): Promise<string> {
  const { source } = opts;
  const requested = opts.rulesEdition ?? "2024";
  monsterName = monsterName.trim();
  if (!monsterName) return "Monster name is required.";
  const homebrew = isHomebrewSource(source);
  // Logged out, monster-service is still asked (anonymously); homebrew needs an account.
  const asker = askerNow();
  if (asker.anonymous && homebrew) return HOMEBREW_LOGIN_REQUIRED;

  try {
    const config = await configFor(asker);
    // No extra request: getGameConfig() serves this call from its cache (or its failure cache).
    const index = await getSourceIndex();
    const info = (m: DdbMonster) => classifyEdition(m, index);
    const tiebreak = monsterTiebreak(index);
    // The source is checked first (the snapshot index can resolve it), so a
    // mistyped one is an error even when the config is down, logged in or out.
    let sourceIds: number[] = [];
    if (source && !homebrew) {
      sourceIds = resolveSourceIds(index, source);
      if (!sourceIds.length) return unknownSourceError(index, source);
    }
    // Without the config (public or session-bound), a stat block would read
    // "(id:N)" / "type N": use Open5e as "unavailable" (owner ruling 2026-11-02).
    // Homebrew has no Open5e answer and keeps its D&D Beyond block.
    if (!config && !homebrew) throw new Error("Game config unavailable");

    // 20 slots per spelling so a crowded name (e.g. "Zombie" has Ash/Beholder/
    // Girallon/Greater/Ogre/Strahd/Yellow Musk/plain across both editions)
    // doesn't miss the intended entry. Homebrew pages through the same
    // MAX_FILTER_SCAN entries as searchMonsters, so get and search agree.
    const { data: candidates, access, snapshot } = homebrew
      ? await fetchMonsterPages(monsterName, [], MAX_FILTER_SCAN, asker)
      : await fetchCandidates(monsterName, 20, sourceIds, asker);

    let detail: MonsterSingleResponse;
    let extras: StatBlockExtras;
    if (homebrew) {
      // Homebrew only (fail closed: anything not explicitly official): exact
      // name first, then partial, each by tiebreak. No twins, so no edition
      // selection, swap, reason or note; a locked entry shows the restricted block.
      const query = normalizeName(monsterName);
      const own = candidates.filter(m => m.isHomebrew !== false);
      const pick = own.filter(m => normalizeName(m.name) === query).sort(tiebreak)[0]
        ?? own.filter(m => normalizeName(m.name).includes(query)).sort(tiebreak)[0];
      if (!pick) return `No homebrew monster found matching "${monsterName}".`;
      detail = await fetchMonsterDetail(pick.id, asker);
      extras = { info: HOMEBREW_INFO, loggedOut: asker.anonymous };
    } else if (source) {
      // With a source, require an exact (twin) name: a partial match would
      // quietly turn "Zombie" in mm-2014 into Beholder Zombie. Near names are offered instead.
      const key = monsterTwin(monsterName);
      const picked = selectByEdition(candidates.filter(m => monsterTwin(m.name) === key), requested, info, tiebreak);
      if (!picked) {
        // A requested book is never silently swapped for another edition or the SRD.
        // Homebrew names are user-authored — keep them out of this hint.
        const similar = [...new Set(namedCandidates(candidates, monsterName).filter(m => !m.isHomebrew).map(m => m.name))].slice(0, 5);
        const available = await availableSourcesFor(monsterName, index, asker, snapshot);
        let msg = `No "${monsterName}" entry found in source "${source}".`;
        if (similar.length) msg += ` Similar names in that source: ${similar.join(", ")}.`;
        msg += available.length
          ? ` Available sources for "${monsterName}": ${available.join(", ")}.`
          : ` Try ddb_search_monsters with a partial name.`;
        return msg;
      }
      // `source` wins over rules_edition, so the reason is dropped; a book of
      // the other edition gets a note instead. A restricted pick is never
      // swapped or replaced with Open5e: the book was asked for, and the
      // restricted block already says the content isn't owned. It does get a
      // hint naming a book where an available version is.
      detail = await fetchMonsterDetail(picked.entry.id, asker);
      const shown = info(detail.data);
      extras = {
        note: sourceNoteFor({ query: source, ids: sourceIds }, requested, index, shown.ruleset),
        // Only 2014/2024 entries are twins, so only they can be shown under
        // another name than the query's (as in lookupByName).
        renamed: isEdition(shown.ruleset) ? renamedFromQuery(monsterName, detail.data.name) : undefined,
        hint: isRestricted(detail)
          ? await availableElsewhere(monsterName, picked.entry, sourceIds, index, asker, snapshot).catch(() => null)
          : null,
        loggedOut: asker.anonymous,
      };
    } else {
      const lookup = (available: (m: DdbMonster) => boolean) => lookupByName(candidates, monsterName, requested, {
        name: m => m.name,
        info,
        tiebreak,
        twinName: monsterTwin,
        // No name contains the query (typos, word order: "Beholdr", "red dragon
        // adult"), but the service ranks its fuzzy hits best-first: take the top
        // hit, whose whole twin group is then the target.
        partialMatch: (all, q) => all.filter(m => normalizeName(m.name).includes(q)).sort(tiebreak)[0] ?? all[0],
        available,
      });
      // The list map picks an available entry (the requested edition's first,
      // else the other edition's with a locked-… reason) without fetching a
      // locked one's stat block.
      const mapAvailable = (m: DdbMonster) => !isLockedIn(access, m.id);
      let found = lookup(mapAvailable);
      if (!found) {
        const o5Result = await o5GetMonster(monsterName, requested, "not-found").catch(() => null);
        if (o5Result) return o5Result;
        return `Monster "${monsterName}" not found. Try ddb_search_monsters with a partial name.`;
      }
      // Logged out, a locked requested edition with SRD text shows that text
      // rather than the other edition (owner ruling 2026-11-02).
      if (asker.anonymous && isLockedReason(found.reason)) {
        const wanted = lookup(() => true)?.entry;
        if (wanted && info(wanted).ruleset === requested) {
          const srd = await o5MonsterInEdition(wanted.name, requested).catch(() => null);
          if (srd) return srd.text("needs-login");
        }
      }
      detail = await fetchMonsterDetail(found.entry.id, asker);
      // The detail check is the fallback when the map lacked the id or called a
      // restricted pick available: try the next candidate in the same order,
      // at most one extra (cached) detail request.
      const first = found;
      if (isRestricted(detail) && !isLockedIn(access, first.entry.id)) {
        const retry = lookup(m => mapAvailable(m) && m.id !== first.entry.id);
        if (retry && retry.entry.id !== first.entry.id) {
          const retryDetail = await fetchMonsterDetail(retry.entry.id, asker);
          if (!isRestricted(retryDetail)) {
            found = retry;
            detail = retryDetail;
          }
        }
      }
      extras = {
        reason: asker.anonymous && isLockedReason(found.reason) ? loggedOutReason(found.reason) : found.reason,
        renamed: found.renamed,
        loggedOut: asker.anonymous,
      };

      // Still an empty stat block (unowned content): fall back to Open5e. Logged
      // out, the label says the D&D Beyond version needs a login (owner ruling 2026-11-02).
      if (isRestricted(detail)) {
        // Logged out, the locked pick's edition goes along, so an answer from the
        // other SRD doesn't claim "no <edition> version found".
        const lockedRuleset = info(detail.data).ruleset;
        const o5Result = await (asker.anonymous
          ? o5GetMonster(monsterName, requested, "needs-login", isEdition(lockedRuleset) ? lockedRuleset : undefined)
          : o5GetMonster(monsterName, requested, "unavailable")).catch(() => null);
        if (o5Result) return o5Result;
      }
    }

    const statBlock = formatStatBlock(detail.data, detail.accessType, config, index, extras);
    // Homebrew stat blocks are user-authored free text (trait/action
    // descriptions) — delimit as untrusted. Official WotC content is not.
    // Fail closed: only an explicitly official entry is left plain.
    return detail.data.isHomebrew === false ? statBlock : wrapUntrusted(statBlock);
  } catch {
    if (homebrew) return HOMEBREW_UNREACHABLE;
    const o5Result = await o5GetMonster(monsterName, requested, "unavailable").catch(() => null);
    if (o5Result) return withSourceCaveat(o5Result, source);
    return `Monster "${monsterName}" not found. D&D Beyond is unavailable and "${monsterName}" is not in the SRD.${asker.anonymous ? NOT_LOGGED_IN_SUFFIX : ""}`;
  }
}

/**
 * For a restricted pick in a requested book: the first official entry of its
 * twin group, by tiebreak, that the list map doesn't mark locked and that isn't
 * in that book, as a hint line. Books the index doesn't know are skipped (same
 * filter as availableSourcesFor). A book with no slug is passed by short name.
 */
async function availableElsewhere(
  name: string, pick: DdbMonster, sourceIds: number[], index: SourceIndex, asker: Asker, bound: SessionSnapshot,
): Promise<string | null> {
  const { data, access } = await fetchCandidates(name, 20, undefined, asker, bound);
  const key = monsterTwin(pick.name);
  const inBook = (m: DdbMonster) =>
    sourceIds.includes(m.sourceId) || (m.sources ?? []).some(s => sourceIds.includes(s.sourceId));
  const alt = data
    .filter(m => monsterTwin(m.name) === key && m.isHomebrew === false && index.sources.has(m.sourceId)
      && !isLockedIn(access, m.id) && !inBook(m))
    .sort(monsterTiebreak(index))[0];
  if (!alt) return null;
  const book = index.sources.get(alt.sourceId)!;
  return availableElsewhereHint(sourceLabel(index, alt.sourceId), sourceSlug(book) || book.name);
}

/**
 * The rename line's names when a `source` lookup shows a twin under another
 * name than the query's (Thug → Tough): the 2024 name is the twin key, as in
 * lookupByName. Undefined when the shown name is the query's.
 */
function renamedFromQuery(query: string, shownName: string): { name2014: string; name2024: string } | undefined {
  const normalizedQuery = normalizeName(query);
  if (normalizeName(shownName) === normalizedQuery) return undefined;
  const typed = monsterTwin.spell?.(normalizedQuery) ?? query.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  return normalizeName(shownName) === monsterTwin(shownName)
    ? { name2014: typed, name2024: shownName }
    : { name2014: shownName, name2024: typed };
}

export { searchMonsters, searchMonstersSection, clearMonsterCache, type MonsterSearchParams };

/** Defined beside o5GetMonsterStats, which returns it too. */
export type { MonsterStatsResult };
type UnknownCrResult = Extract<MonsterStatsResult, { status: "unknown-cr" }>;

/**
 * CR and XP for a named monster, for the encounter rater and the treasure
 * generator. Tries the DDB monster service first (anonymously when logged
 * out), then falls back to Open5e.
 * `rulesEdition` (default "2024") picks between edition twins of one creature.
 *
 * Unlike getMonster, it never guesses (on either path): callers fold the CR
 * into a rating or a treasure roll, where a near-miss creature would silently
 * skew the result. So there is no fuzzy fallback, and a partial name matching
 * several distinct creatures ("Red Dragon": Wyrmling … Ancient) is reported as
 * ambiguous with each candidate's CR instead of picked. Homebrew is skipped too:
 * callers print the returned name as trusted text, and the rating should use
 * official CRs.
 *
 * Returns `found`, `not-found`, `unknown-cr` (identified, CR not known),
 * `ambiguous`, or `unavailable`: the name couldn't be looked up because D&D
 * Beyond could not be asked (its branch threw: a network or HTTP error, a
 * timeout, no game config, the typed name's own query failing, or, logged out,
 * the anonymous fetch failing) AND Open5e did not find it, whether Open5e
 * failed or simply has no match (the SRD is a small subset, so a miss proves
 * nothing). When D&D Beyond answered, even with no match, a name Open5e doesn't
 * find stays `not-found`, even if Open5e itself failed. found, unknown-cr and
 * ambiguous are unchanged on every path.
 */
export async function getMonsterStats(name: string, opts: { rulesEdition?: RulesEdition } = {}): Promise<MonsterStatsResult> {
  name = name.trim();
  if (!name) return { status: "not-found" };
  const requested = opts.rulesEdition ?? "2024";
  // Logged out, monster-service is still asked, anonymously.
  const asker = askerNow();
  // The session this lookup runs under: a failure after it changed is an account change, not an outage.
  const snapshot = captureSession();
  // Set when D&D Beyond's only pick is another edition's entry with an unknown CR.
  let unknownElsewhere: UnknownCrResult | null = null;
  // Set when D&D Beyond could not be asked (an error, a timeout, no game config).
  let ddbFailed = false;
  try {
    const config = await configFor(asker);
    // No CR table, no CR: Open5e answers instead.
    if (!config) throw new GameConfigUnavailableError();
    // No extra request: getGameConfig() serves this call from its cache (or its failure cache).
    const index = await getSourceIndex();
    const info = (m: DdbMonster) => classifyEdition(m, index);
    const tiebreak = monsterTiebreak(index);
    const crById = new Map(config.challengeRatings.map(cr => [cr.id, cr]));
    // No access map: the requested edition's entry is picked whether or not it
    // is locked (its list entry carries its CR), so logged out a locked 2024
    // entry gives its own CR, never its free 2014 twin's.
    const official = (await fetchCandidates(name, 20, undefined, asker)).data.filter(m => m.isHomebrew === false);
    const stats = (m: DdbMonster) => {
      const cr = crById.get(m.challengeRatingId);
      return cr ? { name: m.name, crValue: cr.value, xp: cr.xp } : { name: m.name, crValue: null, xp: null };
    };
    // The edition is picked over every name match first; a pick whose CR the
    // config doesn't know is never replaced by its other-edition twin (fail
    // closed, as o5GetMonsterStats does): it is unknown-cr.
    const found = (group: DdbMonster[]): MonsterStatsResult | null => {
      const picked = selectByEdition(group, requested, info, tiebreak);
      if (!picked) return null;
      const s = stats(picked.entry);
      return s.crValue !== null && s.xp !== null
        ? { status: "found", name: s.name, crValue: s.crValue, xp: s.xp, info: info(picked.entry) }
        : { status: "unknown-cr", name: s.name, info: info(picked.entry) };
    };
    // D&D Beyond identified the creature but not its CR. The requested
    // edition's entry ends the lookup there: Open5e must not answer with the
    // other edition's SRD record. Another edition's pick (no requested-edition
    // entry) still lets Open5e try the requested edition's SRD.
    const settle = (result: MonsterStatsResult | null): MonsterStatsResult | null => {
      if (result?.status !== "unknown-cr" || result.info.ruleset === requested) return result;
      unknownElsewhere = result;
      return null;
    };

    const key = monsterTwin(name);
    const exact = official.filter(m => monsterTwin(m.name) === key);
    if (exact.length) {
      const result = settle(found(exact));
      if (result) return result;
    } else {
      const query = normalizeName(name);
      const groups = new Map<string, DdbMonster[]>();
      for (const m of official) {
        if (!normalizeName(m.name).includes(query)) continue;
        const k = monsterTwin(m.name);
        groups.set(k, [...(groups.get(k) ?? []), m]);
      }
      if (groups.size === 1) {
        const result = settle(found([...groups.values()][0]));
        if (result) return result;
      } else if (groups.size > 1) {
        const candidates = [...groups.values()]
          .map(group => selectByEdition(group, requested, info, tiebreak))
          .filter(picked => picked !== null)
          .map(picked => stats(picked.entry));
        // Unknown CRs are listed ("CR unknown"), last; all unknown falls through to Open5e.
        if (candidates.some(c => c.crValue !== null)) {
          candidates.sort((a, b) => (a.crValue === null ? 1 : 0) - (b.crValue === null ? 1 : 0)
            || (a.crValue ?? 0) - (b.crValue ?? 0) || a.name.localeCompare(b.name));
          return { status: "ambiguous", candidates };
        }
      }
    }
  } catch (e) {
    // A session change DURING this lookup must surface, never be papered over with
    // another account's (or Open5e's) answer, whether it arrived as the error itself
    // or as an aborted request. A lookup that started already logged out or revoked
    // is not a change: assertSessionCurrent throws for it, but its generation is
    // still the one captured above, so it falls through to the logged-out path.
    if (captureSession().generation !== snapshot.generation) throw e instanceof SessionChangedError ? e : new SessionChangedError();
    // Fall through to Open5e. Only a bug is logged (an outage is in the output); stderr, because stdout carries the MCP stream.
    ddbFailed = true;
    if (!(e instanceof SessionChangedError) && !isExpectedOutage(e)) {
      process.stderr.write(`[ddb-mcp] monster lookup failed for ${JSON.stringify(name)}: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  const o5 = await o5GetMonsterStats(name, requested);
  // Assigned inside `settle`, which TypeScript's narrowing doesn't follow.
  const elsewhere = unknownElsewhere as UnknownCrResult | null;
  if (!elsewhere) {
    // Open5e's miss proves nothing while D&D Beyond could not be asked (the SRD is
    // a small subset): unavailable. When D&D Beyond answered, an Open5e failure
    // leaves its no-match standing.
    if (o5.status === "unavailable") return ddbFailed ? o5 : { status: "not-found" };
    if (o5.status === "not-found" && ddbFailed) return { status: "unavailable" };
    return o5;
  }
  // D&D Beyond identified the creature: only Open5e's record of that same
  // creature (same twin key) may answer for it, never a partial match on another.
  const same = (o5.status === "found" || o5.status === "unknown-cr") && monsterTwin(o5.name) === monsterTwin(elsewhere.name);
  return same ? o5 : elsewhere;
}
