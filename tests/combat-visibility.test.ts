/**
 * Action visibility (spec §4): a class-bucket action naming a class feature the
 * character lacks (absent, above the class level, or an unchosen optional
 * feature) is hidden everywhere. Other buckets keep today's behaviour.
 */
import { describe, expect, it } from "vitest";
import { BONUS, CLASS_FEATURE, FEAT, OPTION, REACTION, SPECIAL, action, actions, block, combat, feature, fighter, limited } from "./fixtures/combat-helpers.js";

const STEADY = 3035892;

describe("action visibility", () => {
  it("hides a class action whose class feature the character lacks, everywhere", () => {
    const out = combat(actions({ class: [action("Steady Aim", STEADY, CLASS_FEATURE, BONUS, limited)] }));
    expect(out).not.toContain("Steady Aim");
  });

  it("shows it when chosen through optionalClassFeatures", () => {
    const out = combat({
      ...actions({ class: [action("Steady Aim", STEADY, CLASS_FEATURE, BONUS, limited)] }),
      optionalClassFeatures: [{ classFeatureId: STEADY }],
    });
    expect(block(out, "BONUS ACTIONS")).toContain("• Steady Aim");
  });

  it("hides an action whose class feature is above the class level", () => {
    const out = combat({
      classes: [fighter({ classFeatures: [feature(500, "Late Trick", { requiredLevel: 9 })] })],
      ...actions({ class: [action("Late Trick", 500, CLASS_FEATURE, BONUS)] }),
    });
    expect(out).not.toContain("Late Trick");
  });

  it("hides Initiate a Circle Spell and Circle Spell options, and shows them when the feature is chosen", () => {
    const acts = actions({ class: [
      action("Initiate a Circle Spell", 12373777, CLASS_FEATURE, BONUS, limited),
      action("Circle Spell: Fireball", 12373777, CLASS_FEATURE, REACTION, limited),
    ] });
    const hidden = combat(acts);
    expect(hidden).not.toContain("Circle Spell");
    const shown = combat({ ...acts, optionalClassFeatures: [{ classFeatureId: 12373777 }] });
    expect(block(shown, "BONUS ACTIONS")).toContain("• Initiate a Circle Spell");
    expect(block(shown, "REACTIONS")).toContain("• Circle Spell: Fireball");
  });

  it("counts an explicit requiredLevel 0 as level 0, not 1", () => {
    const out = combat({
      classes: [fighter({ level: 0, classFeatures: [feature(800, "Zero Trick", { requiredLevel: 0 })] })],
      ...actions({ class: [action("Zero Trick", 800, CLASS_FEATURE, BONUS)] }),
    });
    expect(block(out, "BONUS ACTIONS")).toContain("• Zero Trick");
  });

  it("hides a limited-use option action of an unchosen class feature from LIMITED USE, and shows it otherwise", () => {
    const options = { class: [{ componentId: 3035679, componentTypeId: CLASS_FEATURE, definition: { id: 1306486, entityTypeId: OPTION, name: "Tireless" } }] };
    const acts = actions({ class: [action("Tireless Charge", 1306486, OPTION, SPECIAL, limited)] });
    expect(combat({ options, ...acts })).not.toContain("Tireless Charge");
    const shown = combat({ options, ...acts, classes: [fighter({ classFeatures: [feature(3035679, "Deft Explorer")] })] });
    expect(block(shown, "LIMITED USE")).toContain("• Tireless Charge");
  });

  it("hides an option action whose option belongs to an unchosen class feature", () => {
    const options = { class: [{ componentId: 3035679, componentTypeId: CLASS_FEATURE, definition: { id: 1306486, entityTypeId: OPTION, name: "Tireless (10th Level)" } }] };
    const acts = actions({ class: [
      action("Deft Explorer: Tireless", 1306486, OPTION, BONUS),
      action("Deft Explorer: Tireless (exhaustion)", 1306486, OPTION, SPECIAL),
    ] });
    const hidden = combat({ options, ...acts });
    expect(hidden).not.toContain("Deft Explorer");
    const shown = combat({ options, ...acts, classes: [fighter({ classFeatures: [feature(3035679, "Deft Explorer")] })] });
    expect(block(shown, "BONUS ACTIONS")).toContain("• Deft Explorer: Tireless");
  });

  it("keeps a feat action whose feat is not on the sheet", () => {
    const out = combat(actions({ feat: [action("Mystery Feat Move", 777, FEAT, BONUS)] }));
    expect(block(out, "BONUS ACTIONS")).toContain("• Mystery Feat Move");
  });

  it("applies the rule only in the class bucket", () => {
    const out = combat(actions({ race: [action("Racial Move", 778, CLASS_FEATURE, BONUS)] }));
    expect(block(out, "BONUS ACTIONS")).toContain("• Racial Move");
  });

  it("keeps a subclass action whose feature is only in subclassDefinition.classFeatures", () => {
    const sub = (requiredLevel: number) => combat({
      classes: [fighter({ subclassDefinition: { name: "Sub", classFeatures: [{ id: 600, requiredLevel }] } })],
      ...actions({ class: [action("Sub Trick", 600, CLASS_FEATURE, BONUS)] }),
    });
    expect(block(sub(3), "BONUS ACTIONS")).toContain("• Sub Trick");
    expect(sub(7)).not.toContain("Sub Trick");
  });

  it("skips null action entries", () => {
    const out = combat({
      classes: [fighter({ classFeatures: [feature(901, "Second Wind")] })],
      ...actions({ class: [null, action("Second Wind", 901, CLASS_FEATURE, BONUS)] }),
    });
    expect(block(out, "BONUS ACTIONS")).toContain("• Second Wind");
    expect(out).not.toContain("undefined");
  });
});

