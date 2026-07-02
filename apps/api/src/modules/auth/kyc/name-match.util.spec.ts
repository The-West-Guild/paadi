import { nameMatches } from "./name-match.util";

describe("nameMatches", () => {
  const record = { firstName: "Ada", lastName: "Okeke" };

  it("matches case-insensitively and trims whitespace", () => {
    expect(nameMatches({ firstName: "  ada ", lastName: "OKEKE" }, record)).toBe(true);
  });

  it("rejects a first-name mismatch", () => {
    expect(nameMatches({ firstName: "Chidi", lastName: "Okeke" }, record)).toBe(false);
  });

  it("rejects a last-name mismatch", () => {
    expect(nameMatches({ firstName: "Ada", lastName: "Nwosu" }, record)).toBe(false);
  });

  it("rejects null profile fields", () => {
    expect(nameMatches({ firstName: null, lastName: null }, record)).toBe(false);
  });
});
