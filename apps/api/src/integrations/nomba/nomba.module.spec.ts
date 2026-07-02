import { ConfigService } from "@nestjs/config";
import { createNombaProvider } from "./nomba.module";
import { MockNombaProvider } from "./mock-nomba.provider";
import { NombaClient } from "./nomba.client";
import { NombaProvider } from "./nomba.provider";

function fakeConfig(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const client = {} as NombaClient;

describe("createNombaProvider", () => {
  it("returns the real NombaProvider when the driver is nomba", () => {
    const provider = createNombaProvider(fakeConfig({ "nomba.driver": "nomba" }), client);
    expect(provider).toBeInstanceOf(NombaProvider);
  });

  it("returns the MockNombaProvider in development when the driver is not nomba", () => {
    const provider = createNombaProvider(
      fakeConfig({ "nomba.driver": "mock", nodeEnv: "development" }),
      client
    );
    expect(provider).toBeInstanceOf(MockNombaProvider);
  });

  it("throws when the driver is not nomba in production", () => {
    expect(() =>
      createNombaProvider(fakeConfig({ "nomba.driver": "mock", nodeEnv: "production" }), client)
    ).toThrow();
  });
});
