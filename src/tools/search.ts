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
    const section = results[i];
    // Every section's hidden twins reach the combined footer, a dropped one's too.
    hidden += section.hidden;
    const body = section.body.trim();
    // A section that matched nothing is omitted (its hidden twins were counted above).
    if (!body || section.noMatch) continue;
    // An Open5e section keeps its own Rules line; a D&D Beyond header is folded into the combined one.
    const text = section.open5e && section.header !== null ? `${section.header}\n${body}` : body;
    sections.push(`## ${CATEGORY_LABELS[ALL_CATEGORIES[i]]}\n\n${text}`);
    if (section.header !== null && !section.open5e) anyHeader = true;
  }

  const footer = searchFooter(rulesEdition, hidden);
  // Nothing listed: the dropped sections' hidden twins still get the footer (owner ruling 2026-11-02).
  if (sections.length === 0) return [`No results found for "${query}".`, ...(footer ? [footer] : [])].join("\n\n");
  // One header and one footer for the whole reply; an all-Open5e reply has no
  // combined header, each section keeps its own Rules line.
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
    case "monsters": return searchMonstersSection({ name: query, rulesEdition, siteSearch: true });
    case "items":    return searchItemsSection({ name: query, rulesEdition, bookNotes });
    case "races":    return searchRacesSection({ name: query, limit: 10, offset: 0, rulesEdition, bookNotes });
    case "classes":  return searchClassesSection({ name: query, limit: 10, offset: 0, rulesEdition, bookNotes });
    case "feats":    return searchFeatsSection({ name: query, limit: 10, offset: 0, rulesEdition, bookNotes });
  }
}
