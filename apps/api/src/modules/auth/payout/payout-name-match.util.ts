export function payoutNameMatches(
  profile: { firstName?: string | null; lastName?: string | null },
  accountName: string
): boolean {
  const tokens = accountName.toLowerCase().split(/\s+/).filter((token) => token.length > 0);
  const first = (profile.firstName ?? "").trim().toLowerCase();
  const last = (profile.lastName ?? "").trim().toLowerCase();
  if (first.length === 0 || last.length === 0) {
    return false;
  }
  return tokens.includes(first) && tokens.includes(last);
}
