import { describe, it, expect } from "vitest";
import { createSpellStore, addSpells, spellList } from "../src/tools/spell-store.js";
import { spell } from "./fixtures/spell-service.js";

describe("spell store", () => {
  it("keeps both editions of a name, keyed by id, grouped by twin name", () => {
    const store = createSpellStore();
    addSpells(store, [spell("Sleep", 1, { id: 1, isLegacy: true }), spell("Sleep", 1, { id: 2, sources: [145] })]);
    expect([...store.byId.keys()]).toEqual([1, 2]);
    expect(store.byTwin.get("sleep")).toEqual([1, 2]);
  });

  it("first occurrence of an id wins", () => {
    const store = createSpellStore();
    addSpells(store, [spell("Bless", 1, { id: 3, description: "FIRST" }), spell("Bless", 1, { id: 3, description: "SECOND" })]);
    expect(store.byId.size).toBe(1);
    expect(store.byId.get(3)?.definition.description).toBe("FIRST");
    expect(store.byTwin.get("bless")).toEqual([3]);
  });

  it("groups a renamed pair under the 2024 name", () => {
    const store = createSpellStore();
    addSpells(store, [spell("Acid Arrow", 2, { id: 10, isLegacy: true }), spell("Melf's Acid Arrow", 2, { id: 11 })]);
    expect(store.byTwin.get("melf's acid arrow")).toEqual([10, 11]);
  });

  it("drops and counts entries with no definition, id or name", () => {
    const store = createSpellStore();
    const dropped = addSpells(store, [null, {}, { definition: null }, { definition: { name: "X" } },
      { definition: { id: 5 } }, { definition: { id: "7", name: "Y" } }, spell("Ok", 0, { id: 9 })]);
    expect(dropped).toBe(6);
    expect([...store.byId.keys()]).toEqual([9]);
  });

  it("accepts id 0 as a real id and keeps insertion order in spellList", () => {
    const store = createSpellStore();
    expect(addSpells(store, [spell("Zero", 0, { id: 0 }), spell("One", 1, { id: 1 })])).toBe(0);
    expect(spellList(store).map(s => s.definition.name)).toEqual(["Zero", "One"]);
  });
});
