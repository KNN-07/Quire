import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ServiceError } from "@quire/runtime";

/** AES-GCM envelopes bind ciphertext to its owning resource and runtime key. */
export class SecretBox {
  constructor(private readonly key: Uint8Array) {}
  seal(value: string, resource: string): Uint8Array {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(resource));
    const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), bytes]);
  }
  open(envelope: Uint8Array, resource: string): string {
    if (envelope[0] !== 1 || envelope.length < 29) {
      throw new ServiceError("SECRET_INVALID", 503, "Encrypted credential is invalid");
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, envelope.slice(1, 13));
      decipher.setAAD(Buffer.from(resource));
      decipher.setAuthTag(envelope.slice(13, 29));
      return Buffer.concat([decipher.update(envelope.slice(29)), decipher.final()]).toString("utf8");
    } catch (error) {
      if (error instanceof Error) throw new ServiceError("SECRET_INVALID", 503, "Credential key or authentication mismatch");
      throw error;
    }
  }
}
