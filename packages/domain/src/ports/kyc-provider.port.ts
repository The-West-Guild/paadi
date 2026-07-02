export interface BvnRecord {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phoneNumber: string;
  reference: string;
}

export interface LivenessResult {
  passed: boolean;
  confidence: number;
  reference: string;
}

export abstract class KycProvider {
  abstract validateBvn(bvn: string): Promise<BvnRecord>;
  abstract verifyLiveness(image: string, bvnReference: string): Promise<LivenessResult>;
}
