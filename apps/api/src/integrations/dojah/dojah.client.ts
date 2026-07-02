import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BvnRecord, LivenessResult } from "@paadi/domain";

@Injectable()
export class DojahClient {
  constructor(private readonly config: ConfigService) {}

  async validateBvn(bvn: string): Promise<BvnRecord> {
    const response = await fetch(`${this.config.get<string>("dojah.baseUrl")}/api/v1/kyc/bvn?bvn=${bvn}`, {
      method: "GET",
      headers: this.headers()
    });
    const body = (await response.json()) as { entity: DojahBvnEntity };
    const entity = body.entity;
    return {
      firstName: entity.first_name,
      lastName: entity.last_name,
      dateOfBirth: entity.date_of_birth,
      phoneNumber: entity.phone_number1,
      reference: entity.reference_id
    };
  }

  async verifyLiveness(image: string, bvnReference: string): Promise<LivenessResult> {
    const response = await fetch(`${this.config.get<string>("dojah.baseUrl")}/api/v1/kyc/photoid/verify`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ photoid_image_url_or_base64: image })
    });
    const body = (await response.json()) as { entity: DojahLivenessEntity };
    const entity = body.entity;
    return {
      passed: entity.match,
      confidence: entity.match_confidence,
      reference: bvnReference
    };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.config.get<string>("dojah.apiKey") ?? "",
      AppId: this.config.get<string>("dojah.appId") ?? ""
    };
  }
}

interface DojahBvnEntity {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  phone_number1: string;
  reference_id: string;
}

interface DojahLivenessEntity {
  match: boolean;
  match_confidence: number;
}
