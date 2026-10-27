// Type declarations for release-history.mjs so tests/ can be type-checked.
export type GitRunner = (args: string[]) => string;
export function runGit(args: string[]): string;
export function resolveReleaseCommit(tag: string, git?: GitRunner): string;
export function collectReleaseHistory(
  tag: string | null | undefined,
  git?: GitRunner,
): { gitLog: string; diffStat: string };
