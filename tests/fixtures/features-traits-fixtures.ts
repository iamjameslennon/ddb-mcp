/**
 * Fixtures for the class-feature and racial-trait search tests.
 *
 * Shapes come from live D&D Beyond character-service responses captured
 * 2026-10-17 (the `data` field of each response), trimmed to the fields the
 * search code reads. Every non-empty description, summary and snippet is
 * replaced with placeholder text: "<p>{name} description</p>",
 * "{name} summary" and "{name} snippet". Empty strings and nulls are kept as
 * they came back. No real D&D Beyond text is included.
 *
 * Synthetic entries (not from D&D Beyond), each marked `// synthetic` below:
 * - subclass 900001 "Homebrew Duelist" and its feature 900002 "Riposte Flourish"
 * - optional feature 900003 "Synthetic Option" (class 10)
 * - the summary on Fighter (10) Action Surge, which the source leaves null
 * - the snippet "Deals 1d4 {{modifier:str}} damage." on Elven Lineage Spells (13856114)
 *
 * Race keys are "<entityRaceTypeId>:<entityRaceId>".
 */

// Fighter (10) and Fighter (2190879): base features only, in source order.
export const CLASSES = [
  {
    id: 10,
    name: "Fighter",
    description: "<p>Fighter description</p>",
    hitDice: 10,
    isHomebrew: false,
    spellCastingAbilityId: null,
    subclasses: null,
    subclassDefinition: null,
    parentClassId: null,
    sources: [
      {
        sourceId: 1,
        pageNumber: 70,
        sourceType: 1,
      },
    ],
    classFeatures: [
      {
        id: 192,
        name: "Second Wind",
        description: "<p>Second Wind description</p>",
        summary: "Second Wind summary",
        requiredLevel: 1,
        displayOrder: 5,
        featuresSectionType: 1,
        prerequisite: null,
        moreDetailsUrl: "/classes/10-fighter#SecondWind-192",
      },
      {
        id: 193,
        name: "Action Surge",
        description: "<p>Action Surge description</p>",
        summary: "Action Surge summary", // synthetic
        requiredLevel: 2,
        displayOrder: 6,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/10-fighter#ActionSurge-193",
      },
      {
        id: 195,
        name: "Ability Score Improvement",
        description: "<p>Ability Score Improvement description</p>",
        summary: null,
        requiredLevel: 4,
        displayOrder: 8,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/10-fighter#AbilityScoreImprovement-195",
      },
      {
        id: 196,
        name: "Extra Attack",
        description: "<p>Extra Attack description</p>",
        summary: null,
        requiredLevel: 5,
        displayOrder: 9,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/10-fighter#ExtraAttack-196",
      },
      {
        id: 199,
        name: "Ability Score Improvement",
        description: "<p>Ability Score Improvement description</p>",
        summary: null,
        requiredLevel: 6,
        displayOrder: 10,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/10-fighter#AbilityScoreImprovement-199",
      },
      {
        id: 200,
        name: "Ability Score Improvement",
        description: "<p>Ability Score Improvement description</p>",
        summary: null,
        requiredLevel: 8,
        displayOrder: 11,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/10-fighter#AbilityScoreImprovement-200",
      },
      {
        id: 201,
        name: "Ability Score Improvement",
        description: "<p>Ability Score Improvement description</p>",
        summary: null,
        requiredLevel: 12,
        displayOrder: 14,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/10-fighter#AbilityScoreImprovement-201",
      },
      {
        id: 202,
        name: "Ability Score Improvement",
        description: "<p>Ability Score Improvement description</p>",
        summary: null,
        requiredLevel: 14,
        displayOrder: 15,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/10-fighter#AbilityScoreImprovement-202",
      },
      {
        id: 203,
        name: "Ability Score Improvement",
        description: "<p>Ability Score Improvement description</p>",
        summary: null,
        requiredLevel: 16,
        displayOrder: 16,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/10-fighter#AbilityScoreImprovement-203",
      },
      {
        id: 204,
        name: "Ability Score Improvement",
        description: "<p>Ability Score Improvement description</p>",
        summary: null,
        requiredLevel: 19,
        displayOrder: 17,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/10-fighter#AbilityScoreImprovement-204",
      },
      {
        id: 205,
        name: "Extra Attack",
        description: "<p>Extra Attack description</p>",
        summary: null,
        requiredLevel: 11,
        displayOrder: 13,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/10-fighter#ExtraAttack-205",
      },
      {
        id: 206,
        name: "Extra Attack",
        description: "<p>Extra Attack description</p>",
        summary: null,
        requiredLevel: 20,
        displayOrder: 18,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/10-fighter#ExtraAttack-206",
      },
    ],
  },
  {
    id: 2190879,
    name: "Fighter",
    description: "<p>Fighter description</p>",
    hitDice: 10,
    isHomebrew: false,
    spellCastingAbilityId: null,
    subclasses: null,
    subclassDefinition: null,
    parentClassId: null,
    sources: [
      {
        sourceId: 145,
        pageNumber: 90,
        sourceType: 1,
      },
    ],
    classFeatures: [
      {
        id: 10292233,
        name: "Second Wind",
        description: "<p>Second Wind description</p>",
        summary: "Second Wind summary",
        requiredLevel: 1,
        displayOrder: 3,
        featuresSectionType: 1,
        prerequisite: null,
        moreDetailsUrl: "/classes/2190879-fighter#SecondWind-10292233",
      },
      {
        id: 10292235,
        name: "Action Surge",
        description: "<p>Action Surge description</p>",
        summary: null,
        requiredLevel: 2,
        displayOrder: 5,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/2190879-fighter#ActionSurge-10292235",
      },
      {
        id: 10292238,
        name: "Ability Score Improvement",
        description: "<p>Ability Score Improvement description</p>",
        summary: null,
        requiredLevel: 4,
        displayOrder: 8,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/2190879-fighter#AbilityScoreImprovement-10292238",
      },
      {
        id: 10292239,
        name: "Extra Attack",
        description: "<p>Extra Attack description</p>",
        summary: null,
        requiredLevel: 5,
        displayOrder: 9,
        featuresSectionType: null,
        prerequisite: null,
        moreDetailsUrl: "/classes/2190879-fighter#ExtraAttack-10292239",
      },
    ],
  },
];

// Subclasses by parent class id. Champion (16) is from sourceId 1;
// Champion (2190931) is from sourceId 145. The synthetic subclass is marked below.
export const SUBCLASSES_BY_CLASS_ID: Record<string, unknown[]> = {
  "10": [
    {
      id: 16,
      name: "Champion",
      parentClassId: 10,
      isHomebrew: false,
      sources: [
        {
          sourceId: 1,
          pageNumber: null,
          sourceType: 1,
        },
      ],
      classFeatures: [
        {
          id: 215,
          name: "Improved Critical",
          description: "<p>Improved Critical description</p>",
          summary: null,
          requiredLevel: 3,
          displayOrder: 1,
          featuresSectionType: null,
          prerequisite: null,
          moreDetailsUrl: "/classes/10-fighter#Champion#ImprovedCritical-215",
        },
        {
          id: 216,
          name: "Remarkable Athlete",
          description: "<p>Remarkable Athlete description</p>",
          summary: null,
          requiredLevel: 7,
          displayOrder: 2,
          featuresSectionType: null,
          prerequisite: null,
          moreDetailsUrl: "/classes/10-fighter#Champion#RemarkableAthlete-216",
        },
        {
          id: 192,
          name: "Second Wind",
          description: "<p>Second Wind description</p>",
          summary: "Second Wind summary",
          requiredLevel: 1,
          displayOrder: 5,
          featuresSectionType: 1,
          prerequisite: null,
          moreDetailsUrl: "/classes/10-fighter#Champion#SecondWind-192",
        },
        {
          id: 193,
          name: "Action Surge",
          description: "<p>Action Surge description</p>",
          summary: null,
          requiredLevel: 2,
          displayOrder: 6,
          featuresSectionType: null,
          prerequisite: null,
          moreDetailsUrl: "/classes/10-fighter#Champion#ActionSurge-193",
        },
      ],
    },
    // synthetic
    {
      id: 900001,
      name: "Homebrew Duelist",
      parentClassId: 10,
      isHomebrew: true,
      sources: [],
      classFeatures: [
        // synthetic
        {
          id: 900002,
          name: "Riposte Flourish",
          description: "<p>Riposte Flourish description</p>",
          summary: null,
          requiredLevel: 3,
          displayOrder: 1,
          featuresSectionType: 1,
          prerequisite: null,
          moreDetailsUrl: null,
        },
      ],
    },
  ],
  "2190879": [
    {
      id: 2190931,
      name: "Champion",
      parentClassId: 2190879,
      isHomebrew: false,
      sources: [
        {
          sourceId: 145,
          pageNumber: 96,
          sourceType: 1,
        },
      ],
      classFeatures: [
        {
          id: 10292623,
          name: "Improved Critical",
          description: "<p>Improved Critical description</p>",
          summary: null,
          requiredLevel: 3,
          displayOrder: 1,
          featuresSectionType: null,
          prerequisite: null,
          moreDetailsUrl: "/classes/2190879-fighter#Champion#ImprovedCritical-10292623",
        },
        {
          id: 10292626,
          name: "Heroic Warrior",
          description: "<p>Heroic Warrior description</p>",
          summary: null,
          requiredLevel: 10,
          displayOrder: 4,
          featuresSectionType: null,
          prerequisite: null,
          moreDetailsUrl: "/classes/2190879-fighter#Champion#HeroicWarrior-10292626",
        },
      ],
    },
  ],
};

// Optional (unlockable) class features by class id, live `{ definitionData, accessTypes }` shape.
// Martial Versatility is the live locked entry (accessTypes 4); Synthetic Option is synthetic.
export const OPTIONAL_FEATURES_BY_CLASS_ID: Record<string, unknown> = {
  "10": {
    definitionData: [
      {
        id: 3022422,
        name: "Martial Versatility",
        description: "",
        snippet: "",
        requiredLevel: 4,
        displayOrder: 2,
        classId: 10,
        sources: [
          {
            sourceId: 67,
            pageNumber: null,
            sourceType: 1,
          },
        ],
      },
      // synthetic
      {
        id: 900003,
        name: "Synthetic Option",
        requiredLevel: 4,
        classId: 10,
        snippet: "Synthetic Option snippet",
        description: "<p>Synthetic Option description</p>",
        sources: [
          {
            sourceId: 67,
          },
        ],
      },
    ],
    accessTypes: {
      "3022422": 4,
      "900003": 1,
    },
  },
  "2190879": {
    definitionData: [],
    accessTypes: {},
  },
};

// Races, live shape (racial traits wrapped as { definition }).
// Human: only Languages. Elf 2024 / Goliath 2024 / Tiefling 2024: the traits the tests use.
// The homebrew Tiefling (976786) is the owner's homebrew race (isHomebrew: true); its trait
// entries keep the entityRaceId 1751443 that D&D Beyond returns for them.
export const RACES = [
  {
    entityRaceId: 1,
    entityRaceTypeId: 1743923279,
    fullName: "Human",
    baseName: "Human",
    baseRaceName: "Human",
    description: "<p>Human description</p>",
    isHomebrew: false,
    isLegacy: true,
    isSubRace: false,
    size: null,
    sources: [
      {
        sourceId: 1,
        pageNumber: null,
        sourceType: 2,
      },
      {
        sourceId: 2,
        pageNumber: 29,
        sourceType: 1,
      },
    ],
    racialTraits: [
      {
        definition: {
          id: 64,
          name: "Languages",
          description: "<p>Languages description</p>",
          snippet: "Languages snippet",
          requiredLevel: null,
          displayOrder: 6,
          hideInSheet: false,
          hideInBuilder: false,
          hideOnDetailsPage: false,
          entityRaceId: 1,
          entityRaceTypeId: 1743923279,
          sources: [
            {
              sourceId: 1,
              pageNumber: 31,
              sourceType: 1,
            },
          ],
        },
      },
    ],
  },
  {
    entityRaceId: 1,
    entityRaceTypeId: 1228963568,
    fullName: "High Elf",
    baseName: "Elf",
    baseRaceName: "Elf",
    description: "<p>High Elf description</p>",
    isHomebrew: false,
    isLegacy: true,
    isSubRace: true,
    size: null,
    sources: [
      {
        sourceId: 1,
        pageNumber: null,
        sourceType: 2,
      },
      {
        sourceId: 2,
        pageNumber: null,
        sourceType: 1,
      },
    ],
    racialTraits: [
      {
        definition: {
          id: 11,
          name: "Darkvision",
          description: "<p>Darkvision description</p>",
          snippet: "Darkvision snippet",
          requiredLevel: null,
          displayOrder: 6,
          hideInSheet: false,
          hideInBuilder: false,
          hideOnDetailsPage: false,
          entityRaceId: 3,
          entityRaceTypeId: 1743923279,
          sources: [
            {
              sourceId: 1,
              pageNumber: 23,
              sourceType: 1,
            },
          ],
        },
      },
      {
        definition: {
          id: 13,
          name: "Fey Ancestry",
          description: "<p>Fey Ancestry description</p>",
          snippet: "Fey Ancestry snippet",
          requiredLevel: null,
          displayOrder: 8,
          hideInSheet: false,
          hideInBuilder: false,
          hideOnDetailsPage: false,
          entityRaceId: 3,
          entityRaceTypeId: 1743923279,
          sources: [
            {
              sourceId: 1,
              pageNumber: 23,
              sourceType: 1,
            },
          ],
        },
      },
    ],
  },
  {
    entityRaceId: 2,
    entityRaceTypeId: 1228963568,
    fullName: "Wood Elf",
    baseName: "Elf",
    baseRaceName: "Elf",
    description: "<p>Wood Elf description</p>",
    isHomebrew: false,
    isLegacy: true,
    isSubRace: true,
    size: null,
    sources: [
      {
        sourceId: 1,
        pageNumber: null,
        sourceType: 2,
      },
      {
        sourceId: 2,
        pageNumber: null,
        sourceType: 1,
      },
    ],
    racialTraits: [
      {
        definition: {
          id: 11,
          name: "Darkvision",
          description: "<p>Darkvision description</p>",
          snippet: "Darkvision snippet",
          requiredLevel: null,
          displayOrder: 6,
          hideInSheet: false,
          hideInBuilder: false,
          hideOnDetailsPage: false,
          entityRaceId: 3,
          entityRaceTypeId: 1743923279,
          sources: [
            {
              sourceId: 1,
              pageNumber: 23,
              sourceType: 1,
            },
          ],
        },
      },
      {
        definition: {
          id: 13,
          name: "Fey Ancestry",
          description: "<p>Fey Ancestry description</p>",
          snippet: "Fey Ancestry snippet",
          requiredLevel: null,
          displayOrder: 8,
          hideInSheet: false,
          hideInBuilder: false,
          hideOnDetailsPage: false,
          entityRaceId: 3,
          entityRaceTypeId: 1743923279,
          sources: [
            {
              sourceId: 1,
              pageNumber: 23,
              sourceType: 1,
            },
          ],
        },
      },
    ],
  },
  {
    entityRaceId: 1751437,
    entityRaceTypeId: 1743923279,
    fullName: "Elf",
    baseName: "Elf",
    baseRaceName: "Elf",
    description: "<p>Elf description</p>",
    isHomebrew: false,
    isLegacy: false,
    isSubRace: false,
    size: null,
    sources: [
      {
        sourceId: 145,
        pageNumber: 189,
        sourceType: 1,
      },
    ],
    racialTraits: [
      {
        definition: {
          id: 13856109,
          name: "Darkvision",
          description: "<p>Darkvision description</p>",
          snippet: "Darkvision snippet",
          requiredLevel: null,
          displayOrder: 4,
          hideInSheet: false,
          hideInBuilder: false,
          hideOnDetailsPage: false,
          entityRaceId: 1751437,
          entityRaceTypeId: 1743923279,
          sources: [
            {
              sourceId: 145,
              pageNumber: 190,
              sourceType: 1,
            },
          ],
        },
      },
      {
        definition: {
          id: 13856108,
          name: "Speed",
          description: "<p>Speed description</p>",
          snippet: "Speed snippet",
          requiredLevel: null,
          displayOrder: 3,
          hideInSheet: false,
          hideInBuilder: false,
          hideOnDetailsPage: true,
          entityRaceId: 1751437,
          entityRaceTypeId: 1743923279,
          sources: [
            {
              sourceId: 145,
              pageNumber: 190,
              sourceType: 1,
            },
          ],
        },
      },
      {
        definition: {
          id: 13856114,
          name: "Elven Lineage Spells",
          description: "<p>Elven Lineage Spells description</p>",
          snippet: "Deals 1d4 {{modifier:str}} damage.", // synthetic
          requiredLevel: null,
          displayOrder: 6,
          hideInSheet: false,
          hideInBuilder: false,
          hideOnDetailsPage: true,
          entityRaceId: 1751437,
          entityRaceTypeId: 1743923279,
          sources: [
            {
              sourceId: 145,
              pageNumber: 189,
              sourceType: 1,
            },
          ],
        },
      },
    ],
  },
  {
    entityRaceId: 1751439,
    entityRaceTypeId: 1743923279,
    fullName: "Goliath",
    baseName: "Goliath",
    baseRaceName: "Goliath",
    description: "<p>Goliath description</p>",
    isHomebrew: false,
    isLegacy: false,
    isSubRace: false,
    size: null,
    sources: [
      {
        sourceId: 145,
        pageNumber: 192,
        sourceType: 1,
      },
    ],
    racialTraits: [
      {
        definition: {
          id: 13856127,
          name: "Large Form",
          description: "<p>Large Form description</p>",
          snippet: "Large Form snippet",
          requiredLevel: 5,
          displayOrder: 5,
          hideInSheet: true,
          hideInBuilder: false,
          hideOnDetailsPage: false,
          entityRaceId: 1751439,
          entityRaceTypeId: 1743923279,
          sources: [
            {
              sourceId: 145,
              pageNumber: 192,
              sourceType: 1,
            },
          ],
        },
      },
      {
        definition: {
          id: 15478362,
          name: "Large Form",
          description: "<p>Large Form description</p>",
          snippet: "Large Form snippet",
          requiredLevel: 5,
          displayOrder: 5,
          hideInSheet: false,
          hideInBuilder: true,
          hideOnDetailsPage: true,
          entityRaceId: 1751439,
          entityRaceTypeId: 1743923279,
          sources: [
            {
              sourceId: 145,
              pageNumber: 192,
              sourceType: 1,
            },
          ],
        },
      },
    ],
  },
  {
    entityRaceId: 1751443,
    entityRaceTypeId: 1743923279,
    fullName: "Tiefling",
    baseName: "Tiefling",
    baseRaceName: "Tiefling",
    description: "<p>Tiefling description</p>",
    isHomebrew: false,
    isLegacy: false,
    isSubRace: false,
    size: null,
    sources: [
      {
        sourceId: 145,
        pageNumber: 197,
        sourceType: 1,
      },
    ],
    racialTraits: [
      {
        definition: {
          id: 13856159,
          name: "Darkvision",
          description: "<p>Darkvision description</p>",
          snippet: "Darkvision snippet",
          requiredLevel: null,
          displayOrder: 4,
          hideInSheet: false,
          hideInBuilder: false,
          hideOnDetailsPage: false,
          entityRaceId: 1751443,
          entityRaceTypeId: 1743923279,
          sources: [
            {
              sourceId: 145,
              pageNumber: 197,
              sourceType: 1,
            },
          ],
        },
      },
    ],
  },
  {
    entityRaceId: 976786,
    entityRaceTypeId: 1228963568,
    fullName: "Tiefling",
    baseName: "Tiefling",
    baseRaceName: "Tiefling",
    description: "<p>Tiefling description</p>",
    isHomebrew: true,
    isLegacy: false,
    isSubRace: true,
    size: null,
    sources: [],
    racialTraits: [
      {
        definition: {
          id: 13856159,
          name: "Darkvision",
          description: "<p>Darkvision description</p>",
          snippet: "Darkvision snippet",
          requiredLevel: null,
          displayOrder: 4,
          hideInSheet: false,
          hideInBuilder: false,
          hideOnDetailsPage: false,
          entityRaceId: 1751443,
          entityRaceTypeId: 1743923279,
          sources: [
            {
              sourceId: 145,
              pageNumber: 197,
              sourceType: 1,
            },
          ],
        },
      },
    ],
  },
];

// Optional racial traits by race key. Only Human has a live entry; every other key is empty.
export const OPTIONAL_TRAITS_BY_RACE_KEY: Record<string, unknown> = {
  "1743923279:1": {
    definitionData: [
      {
        id: 4566698,
        name: "Languages",
        description: "<p>Languages description</p>",
        snippet: "",
        requiredLevel: null,
        displayOrder: 6,
        sources: [
          {
            sourceId: 1,
            pageNumber: null,
            sourceType: 1,
          },
        ],
        entityRaceId: 1,
        entityRaceTypeId: 1743923279,
      },
    ],
    accessTypes: {
      "4566698": 1,
    },
  },
  "1228963568:1": {
    definitionData: [],
    accessTypes: {},
  },
  "1228963568:2": {
    definitionData: [],
    accessTypes: {},
  },
  "1743923279:1751437": {
    definitionData: [],
    accessTypes: {},
  },
  "1743923279:1751439": {
    definitionData: [],
    accessTypes: {},
  },
  "1743923279:1751443": {
    definitionData: [],
    accessTypes: {},
  },
  "1228963568:976786": {
    definitionData: [],
    accessTypes: {},
  },
};
