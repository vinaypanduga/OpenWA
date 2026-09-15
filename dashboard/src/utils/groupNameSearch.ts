export interface NamedGroup {
  id: string;
  name: string;
}

const normalizeGroupName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/**
 * Excel copies cells as tab-separated columns and newline-separated rows. Treat every non-empty
 * cell as an independent search term and remove case-insensitive duplicates while preserving the
 * order in which the user pasted them.
 */
export function parsePastedGroupNames(value: string): string[] {
  const unique = new Map<string, string>();
  for (const cell of value.split(/[\t\r\n]+/)) {
    const name = cell.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const normalized = normalizeGroupName(name);
    if (!unique.has(normalized)) unique.set(normalized, name);
  }
  return [...unique.values()];
}

export function matchGroupsByNames<T extends NamedGroup>(groups: T[], names: string[]) {
  const normalizedNames = names.map(name => ({ name, normalized: normalizeGroupName(name) }));
  const matchedNames = new Set<string>();
  const matchedGroups = groups.filter(group => {
    const normalizedGroup = normalizeGroupName(group.name);
    let matched = false;
    for (const entry of normalizedNames) {
      if (normalizedGroup.includes(entry.normalized)) {
        matchedNames.add(entry.normalized);
        matched = true;
      }
    }
    return matched;
  });

  return {
    matchedGroups,
    matchedNames: normalizedNames.filter(entry => matchedNames.has(entry.normalized)).map(entry => entry.name),
    unmatchedNames: normalizedNames.filter(entry => !matchedNames.has(entry.normalized)).map(entry => entry.name),
  };
}
