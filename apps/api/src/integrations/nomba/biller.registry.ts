import { BadRequestException, Injectable } from "@nestjs/common";
import { BillerAdapter, BillerCategory } from "@paadi/domain";
import { CableBillerAdapter } from "./cable-biller.adapter";
import { ElectricityBillerAdapter } from "./electricity-biller.adapter";

@Injectable()
export class BillerRegistry {
  private readonly adapters: Map<BillerCategory, BillerAdapter>;

  constructor(electricity: ElectricityBillerAdapter, cable: CableBillerAdapter) {
    this.adapters = new Map<BillerCategory, BillerAdapter>([
      [electricity.category, electricity],
      [cable.category, cable]
    ]);
  }

  get(category: BillerCategory): BillerAdapter {
    const adapter = this.adapters.get(category);
    if (!adapter) {
      throw new BadRequestException(`unsupported biller category: ${category}`);
    }
    return adapter;
  }
}
