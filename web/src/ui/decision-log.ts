export interface DecisionLog {
  readonly size: number;
  note(id: string): boolean;
  newest(limit: number): string[];
  since(size: number, limit?: number): string[];
}

export function createDecisionLog(): DecisionLog {
  const ids: string[] = [];
  const seen = new Set<string>();

  function since(size: number, limit = Number.POSITIVE_INFINITY): string[] {
    const result: string[] = [];
    for (
      let index = ids.length - 1;
      index >= size && result.length < limit;
      index -= 1
    ) {
      result.push(ids[index]!);
    }
    return result;
  }

  return {
    get size() {
      return ids.length;
    },
    note(id) {
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      ids.push(id);
      return true;
    },
    newest(limit) {
      return since(0, limit);
    },
    since,
  };
}
