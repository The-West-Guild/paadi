import { Injectable } from "@nestjs/common";
import { BvnRecord, KycProvider, LivenessResult } from "@paadi/domain";
import { DojahClient } from "./dojah.client";

@Injectable()
export class DojahKycProvider extends KycProvider {
  constructor(private readonly client: DojahClient) {
    super();
  }

  validateBvn(bvn: string): Promise<BvnRecord> {
    return this.client.validateBvn(bvn);
  }

  verifyLiveness(image: string, bvnReference: string): Promise<LivenessResult> {
    return this.client.verifyLiveness(image, bvnReference);
  }
}
