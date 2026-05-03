export declare function parseCharacterData(raw: Record<string, unknown>): string;
export declare function parseCharacter(characterId: string): Promise<string>;
/**
 * Fetch raw character JSON from the DnD Beyond API.
 * Uses saved session cookies — no browser needed after initial login.
 */
export declare function getCharacter(characterId: string): Promise<string>;
export declare function downloadCharacter(characterId: string, outputPath?: string): Promise<string>;
export declare function listCharacters(): Promise<string>;
//# sourceMappingURL=character.d.ts.map