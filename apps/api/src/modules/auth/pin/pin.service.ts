import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { CryptoService } from "../../../common/crypto/crypto.service";
import { UserRepository } from "../../../infra/persistence/user.repository";

@Injectable()
export class PinService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly crypto: CryptoService
  ) {}

  async verify(userId: string, pin: string): Promise<{ ok: boolean }> {
    const user = await this.userRepo.findById(userId);
    if (!user || !user.pinHash) {
      throw new BadRequestException("no pin set");
    }
    const ok = await this.crypto.verifySecret(user.pinHash, pin);
    if (!ok) {
      throw new UnauthorizedException("invalid pin");
    }
    return { ok: true };
  }

  async change(userId: string, currentPin: string, newPin: string): Promise<{ ok: boolean }> {
    await this.verify(userId, currentPin);
    await this.userRepo.setPin(userId, await this.crypto.hashSecret(newPin));
    return { ok: true };
  }
}
