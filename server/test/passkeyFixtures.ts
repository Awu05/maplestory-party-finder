import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

const encode = (value: Uint8Array) => Buffer.from(value).toString('base64url');
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest();
type Overrides = { origin?: string; challenge?: string; rpID?: string; userVerified?: boolean; counter?: number };

export class VirtualPasskey {
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  private readonly credentialId = randomBytes(32);
  private userHandle = '';

  register(options: PublicKeyCredentialCreationOptionsJSON, overrides: Overrides = {}): RegistrationResponseJSON {
    this.userHandle = options.user.id;
    const publicKey = this.keys.publicKey.export({ format: 'jwk' });
    const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([
      [1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(publicKey.x!, 'base64url'))], [-3, new Uint8Array(Buffer.from(publicKey.y!, 'base64url'))],
    ]));
    const length = Buffer.alloc(2);
    length.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      hash(overrides.rpID ?? options.rp.id!), Buffer.from([overrides.userVerified === false ? 0x41 : 0x45]),
      Buffer.alloc(4), Buffer.alloc(16), length, this.credentialId, cose,
    ]);
    const attestation = isoCBOR.encode(new Map<string, string | Uint8Array | Map<string, string>>([
      ['fmt', 'none'], ['authData', new Uint8Array(authData)], ['attStmt', new Map()],
    ]));
    return {
      id: encode(this.credentialId), rawId: encode(this.credentialId), type: 'public-key', clientExtensionResults: {},
      response: {
        clientDataJSON: encode(Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: overrides.challenge ?? options.challenge, origin: overrides.origin ?? 'http://localhost:5173', crossOrigin: false }))),
        attestationObject: encode(attestation), transports: ['internal'],
      },
    };
  }

  authenticate(options: PublicKeyCredentialRequestOptionsJSON, overrides: Overrides = {}): AuthenticationResponseJSON {
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: overrides.challenge ?? options.challenge, origin: overrides.origin ?? 'http://localhost:5173', crossOrigin: false }));
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(overrides.counter ?? 0);
    const authData = Buffer.concat([hash(overrides.rpID ?? options.rpId!), Buffer.from([overrides.userVerified === false ? 0x01 : 0x05]), counter]);
    return {
      id: encode(this.credentialId), rawId: encode(this.credentialId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: encode(clientData), authenticatorData: encode(authData), signature: encode(sign('sha256', Buffer.concat([authData, hash(clientData)]), this.keys.privateKey)), userHandle: this.userHandle },
    };
  }
}
