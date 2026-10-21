export function carriesFiles(
  types: Iterable<string> | null | undefined,
): boolean {
  return types ? Array.from(types).includes("Files") : false;
}
