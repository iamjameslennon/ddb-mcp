import {
  searchSpellsSection, searchItemsSection, searchRacesSection, searchClassesSection, searchFeatsSection,
} from "./reference.js";
import { searchMonstersSection } from "./monster.js";
import { renderSection, plainSection, type SearchSection } from "./edition-search.js";
import { searchHeader, searchFooter, type RulesEdition } from "../edition.js";

export type SearchCategory = "spells" | "monsters" | "items" | "races" | "classes" | "feats" | "all";

const ALL_CATEGORIES = ["spells", "monsters", "items", "races", "classes", "feats"] as const;
type SpecificCategory = (typeof ALL_CATEGORIES)[number];

const CATEGORY_LABELS: Record<SpecificCategory, string> = {
  spells: "Spells",
  monsters: "Monsters",
  items: "Items",
  races: "Races",
  classes: "Classes",
  feats: "Feats",
};

// Each underlying search returns its own "no results" sentence. Detect them so
// we can omit empty sections in the "all" rollup, e.g. Open5e's item fallback:
// "No items found matching the criteria (SRD only)."
const EMPTY_RESULT_PATTERN = /^no\s+[\w\s]+?\s+found/i;

export async function search(
  query: string,
  category: SearchCategory = "all",
  rulesEdition: RulesEdition = "2024"
): Promise<string> {
  if (category !== "all") {
    return renderSection(await runCategory(category, query, rulesEdition));
  }

  const results = await Promise.all(
    ALL_CATEGORIES.map(c =>
      runCategory(c, query, rulesEdition).catch(err => plainSection(`_${err instanceof Error ? err.message : String(err)}_`))
    )
  );

  const sections: string[] = [];
  let anyHeader = false;
  let hidden = 0;
  for (let i = 0; i < ALL_CATEGORIES.length; i++) {
    const body = results[i].body.trim();
    if (!body || EMPTY_RESULT_PATTERN.test(body)) continue;
    sections.push(`## ${CATEGORY_LABELS[ALL_CATEGORIES[i]]}\n\n${body}`);
    if (results[i].header !== null) anyHeader = true;
    hidden += results[i].hidden;
  }

  if (sections.length === 0) return `No results found for "${query}".`;
  // One header and one footer for the whole reply; an all-Open5e reply has no
  // combined header, each section keeps its own Rules line.
  const footer = searchFooter(rulesEdition, hidden);
  return [
    ...(anyHeader ? [searchHeader({ requested: rulesEdition })] : []),
    `# Search results for "${query}"`,
    ...sections,
    ...(footer ? [footer] : []),
  ].join("\n\n");
}

// The site search has no `source` param, so a "pass source to choose" book note would point nowhere.
async function runCategory(category: SpecificCategory, query: string, rulesEdition: RulesEdition): Promise<SearchSection> {
  const bookNotes = false;
  switch (category) {
    case "spells":   return searchSpellsSection({ name: query, limit: 10, rulesEdition, bookNotes });
    case "monsters": return searchMonstersSection({ name: query, rulesEdition });
    case "items":    return searchItemsSection({ name: query, rulesEdition, bookNotes });
    case "races":    return searchRacesSection({ name: query, limit: 10, offset: 0, rulesEdition, bookNotes });
    case "classes":  return searchClassesSection({ name: query, limit: 10, offset: 0, rulesEdition, bookNotes });
    case "feats":    return searchFeatsSection({ name: query, limit: 10, offset: 0, rulesEdition, bookNotes });
  }
}
