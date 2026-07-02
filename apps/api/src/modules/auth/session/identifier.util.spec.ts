import { classifyIdentifier } from "./identifier.util";

describe("classifyIdentifier", () => {
  it("classifies an email address", () => {
    expect(classifyIdentifier("a@b.com")).toEqual({ kind: "email", value: "a@b.com" });
  });

  it("classifies a Nigerian phone number into E164", () => {
    expect(classifyIdentifier("08031234567")).toEqual({ kind: "phone", value: "+2348031234567" });
  });

  it("classifies a bare username", () => {
    expect(classifyIdentifier("ada_lovelace")).toEqual({ kind: "username", value: "ada_lovelace" });
  });

  it("classifies an @-prefixed username", () => {
    expect(classifyIdentifier("@ada_lovelace")).toEqual({ kind: "username", value: "ada_lovelace" });
  });
});
