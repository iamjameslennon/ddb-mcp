import { searchSpells, searchItems, searchRaces, searchClasses, searchFeats } from "./reference.js";
import { searchMonsters } from "./monster.js";

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
// we can omit empty sections in the "all" rollup.
const EMPTY_RESULT_PATTERN = /^no\s+\w+\s+found/i;

export async function search(query: string, category: SearchCategory = "all"): Promise<string> {
  if (category !== "all") {
    return runCategory(category, query);
  }

  const results = await Promise.all(
    ALL_CATEGORIES.map(c =>
      runCategory(c, query).catch(err => `_${err instanceof Error ? err.message : String(err)}_`)
    )
  );

  const sections: string[] = [];
  for (let i = 0; i < ALL_CATEGORIES.length; i++) {
    const body = results[i].trim();
    if (!body || EMPTY_RESULT_PATTERN.test(body)) continue;
    sections.push(`## ${CATEGORY_LABELS[ALL_CATEGORIES[i]]}\n\n${body}`);
  }

  if (sections.length === 0) return `No results found for "${query}".`;
  return [`# Search results for "${query}"`, ...sections].join("\n\n");
}

async function runCategory(category: SpecificCategory, query: string): Promise<string> {
  switch (category) {
    case "spells":   return searchSpells({ name: query, limit: 10 });
    case "monsters": return searchMonsters({ name: query });
    case "items":    return searchItems({ name: query });
    case "races":    return searchRaces(query, 10, 0);
    case "classes":  return searchClasses(query, 10, 0);
    case "feats":    return searchFeats({ name: query, limit: 10, offset: 0 });
  }
}
