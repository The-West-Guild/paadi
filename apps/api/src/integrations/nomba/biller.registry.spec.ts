import { BadRequestException } from "@nestjs/common";
import { PaymentProviderPort } from "@paadi/domain";
import { BillerRegistry } from "./biller.registry";
import { CableBillerAdapter } from "./cable-biller.adapter";
import { ElectricityBillerAdapter } from "./electricity-biller.adapter";

function fakePort() {
  return {
    listElectricityDiscos: jest.fn(async () => []),
    lookupElectricityCustomer: jest.fn(async () => ({ customerName: "ADA OKEKE" })),
    listCableProducts: jest.fn(async () => []),
    lookupCableCustomer: jest.fn(async () => ({ customerName: "ADA OKEKE" })),
    payElectricity: jest.fn(async () => ({ vendToken: "TK" })),
    payCable: jest.fn(async () => ({ status: "success" }))
  };
}

function build() {
  const port = fakePort();
  const electricity = new ElectricityBillerAdapter(port as unknown as PaymentProviderPort);
  const cable = new CableBillerAdapter(port as unknown as PaymentProviderPort);
  const registry = new BillerRegistry(electricity, cable);
  return { port, electricity, cable, registry };
}

describe("BillerRegistry", () => {
  it("returns the electricity adapter for the electricity category", () => {
    const { registry, electricity } = build();
    expect(registry.get("electricity")).toBe(electricity);
  });

  it("returns the cable adapter for the cable category", () => {
    const { registry, cable } = build();
    expect(registry.get("cable")).toBe(cable);
  });

  it("throws for an unknown category", () => {
    const { registry } = build();
    expect(() => registry.get("airtime" as never)).toThrow(BadRequestException);
  });
});

describe("ElectricityBillerAdapter", () => {
  it("delegates lookupCustomer to the port carrying the resolved meter type", async () => {
    const { electricity, port } = build();

    await electricity.lookupCustomer("ikeja-electric", "123456", { meterType: "POSTPAID" });

    expect(port.lookupElectricityCustomer).toHaveBeenCalledWith("ikeja-electric", "123456", "POSTPAID");
  });

  it("defaults the meter type to prepaid when none is supplied", async () => {
    const { electricity, port } = build();

    await electricity.lookupCustomer("ikeja-electric", "123456");

    expect(port.lookupElectricityCustomer).toHaveBeenCalledWith("ikeja-electric", "123456", "PREPAID");
  });
});
