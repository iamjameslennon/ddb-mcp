/**
 * The character's modifiers whose source is active, by the (bc) rule (owner
 * ruling 2026-11-19): an item's only while the item is active (equipped, and
 * attuned when it requires attunement: `isActiveItemMod`), and a class- or
 * subclass-bucket one only while the feature it comes from is visible
 * (`isVisibleAction`, the rule that hides actions; the subclass bucket follows
 * the class bucket). Race, feat, background and other buckets always count.
 *
 * Shared by the global save and ability-check bonuses, per-skill and
 * initiative bonuses (parked 2026-11-20) and the save-advantage lines.
 * `core.allMods` applies neither gate.
 */

import { hiddenOptionIds, isVisibleAction, visibleClassFeatureIds } from "./granting.js";
import { obj, records } from "./helpers.js";
import { isActiveItemMod } from "./item-gate.js";
import type { CoreStats, Mod } from "./types.js";

/** Every active modifier with the bucket it sits in, in bucket and list order; a null or non-object entry is skipped. */
export function activeBucketMods(core: CoreStats): Array<{ bucket: string; mod: Mod }> {
  const { char, classes, inventory } = core;
  const visibleIds = visibleClassFeatureIds(char, classes);
  const hiddenOptions = hiddenOptionIds(char, visibleIds);
  const out: Array<{ bucket: string; mod: Mod }> = [];
  for (const [bucket, list] of Object.entries(obj(char.modifiers))) {
    for (const mod of records<Mod>(list)) {
      if (!isActiveItemMod(mod, inventory)) continue;
      if (!isVisibleAction(bucket === "subclass" ? "class" : bucket, mod, visibleIds, hiddenOptions)) continue;
      out.push({ bucket, mod });
    }
  }
  return out;
}
