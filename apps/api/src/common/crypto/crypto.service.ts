import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

const DEV_SEED = "paadi-dev-key";

@Injectable()
export class CryptoService {
  constructor(private readonly config: ConfigService) {}

  encryptPhone(plaintext: string): string {
    return this.encrypt(plaintext, this.key("crypto.phoneEncryptionKey", "phone"));
  }

  decryptPhone(payload: string): string {
    return this.decrypt(payload, this.key("crypto.phoneEncryptionKey", "phone"));
  }

  encryptAccountNumber(plaintext: string): string {
    return this.encrypt(plaintext, this.key("crypto.accountNumberEncryptionKey", "account"));
  }

  decryptAccountNumber(payload: string): string {
    return this.decrypt(payload, this.key("crypto.accountNumberEncryptionKey", "account"));
  }

  phoneBlindIndex(value: string): string {
    return createHmac("sha256", this.secret("crypto.phoneBlindIndexKey", "phone-index")).update(value).digest("hex");
  }

  hashOtp(code: string): string {
    return createHmac("sha256", this.secret("crypto.otpPepper", "otp-pepper")).update(code).digest("base64");
  }

  sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  randomOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, "0");
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString("base64url");
  }

  hashSecret(secret: string): Promise<string> {
    return argonHash(secret);
  }

  verifySecret(hash: string, secret: string): Promise<boolean> {
    return argonVerify(hash, secret);
  }

  private encrypt(plaintext: string, key: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
  }

  private decrypt(payload: string, key: Buffer): string {
    const raw = Buffer.from(payload, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }

  private key(path: string, label: string): Buffer {
    return createHash("sha256").update(this.secret(path, label)).digest();
  }

  private secret(path: string, label: string): string {
    const configured = this.config.get<string>(path) ?? "";
    if (configured.length > 0) {
      return configured;
    }
    if ((this.config.get<string>("nodeEnv") ?? "development") === "production") {
      throw new Error(`Missing required secret: ${path}`);
    }
    return `${DEV_SEED}:${label}`;
  }
}
