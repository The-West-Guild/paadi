import { Injectable } from "@nestjs/common";
import { BvnRecord, KycProvider, LivenessResult } from "@paadi/domain";

const TEST_BVNS: Record<string, BvnRecord> = {
  "22222222222": {
    firstName: "Ada",
    lastName: "Okeke",
    dateOfBirth: "1990-01-01",
    phoneNumber: "+2348000000001",
    reference: "mock-bvn-ada-okeke"
  },
  "11111111111": {
    firstName: "Chidi",
    lastName: "Nwosu",
    dateOfBirth: "1988-06-15",
    phoneNumber: "+2348000000002",
    reference: "mock-bvn-chidi-nwosu"
  }
};

@Injectable()
export class MockKycProvider extends KycProvider {
  async validateBvn(bvn: string): Promise<BvnRecord> {
    const record = TEST_BVNS[bvn];
    if (!record) {
      throw new Error("BVN not found");
    }
    return record;
  }

  async verifyLiveness(image: string, bvnReference: string): Promise<LivenessResult> {
    void image;
    void bvnReference;
    return { passed: true, confidence: 0.99, reference: "mock-liveness" };
  }
}
