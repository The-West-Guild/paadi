import { payoutNameMatches } from "./payout-name-match.util";

describe("payoutNameMatches", () => {
  it("matches both name tokens against the account name", () => {
    expect(payoutNameMatches({ firstName: "Ada", lastName: "Okeke" }, "ADA OKEKE")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(payoutNameMatches({ firstName: "aDa", lastName: "oKeKe" }, "ada okeke")).toBe(true);
  });

  it("returns false for a partial token rather than a whole word", () => {
    expect(payoutNameMatches({ firstName: "an", lastName: "Okeke" }, "ANANYA OKEKE")).toBe(false);
  });

  it("returns false when the first name is empty", () => {
    expect(payoutNameMatches({ firstName: "", lastName: "Okeke" }, "ADA OKEKE")).toBe(false);
  });

  it("returns false when the last name is empty", () => {
    expect(payoutNameMatches({ firstName: "Ada", lastName: "" }, "ADA OKEKE")).toBe(false);
  });
});
