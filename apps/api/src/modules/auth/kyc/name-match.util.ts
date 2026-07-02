export function nameMatches(
  a: { firstName?: string | null; lastName?: string | null },
  b: { firstName: string; lastName: string }
): boolean {
  const norm = (value?: string | null): string => (value ?? "").trim().toLowerCase();
  return norm(a.firstName) === norm(b.firstName) && norm(a.lastName) === norm(b.lastName);
}
