import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { PrismaService } from '../prisma/prisma.service';
import { cacheGet, cacheSet, cacheBust } from '../billing/cache';
import { AuthService } from './auth.service';

@Injectable()
export class PasskeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private get rpID() {
    return process.env.WEBAUTHN_RP_ID || 'localhost';
  }
  private get rpName() {
    return process.env.WEBAUTHN_RP_NAME || 'TomaFix';
  }
  private get origin() {
    return process.env.WEBAUTHN_ORIGIN || 'http://localhost:5173';
  }

  // ── Registration ────────────────────────────────────────────────────────

  async getRegistrationOptions(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { passkeys: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const excludeCredentials = user.passkeys.map((pk) => ({
      id: pk.credentialId,
      transports: pk.transports as any[],
    }));

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userID: new TextEncoder().encode(userId),
      userName: user.email || userId,
      userDisplayName: user.fullName || user.email || userId,
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
        authenticatorAttachment: 'platform', // device-only (Touch ID / Face ID / PIN)
      },
      attestationType: 'none',
    });

    // Store challenge for 5 min
    cacheSet(`passkey:reg:${userId}`, options.challenge, 5 * 60 * 1000);
    return options;
  }

  async confirmRegistration(userId: string, response: any, deviceName?: string) {
    const expectedChallenge = cacheGet<string>(`passkey:reg:${userId}`);
    if (!expectedChallenge) {
      throw new BadRequestException('Registration challenge expired. Please try again.');
    }
    cacheBust(`passkey:reg:${userId}`);

    let verification: any;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
    } catch (err: any) {
      throw new BadRequestException(`Passkey setup failed: ${err?.message || 'Unknown error'}`);
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('Passkey could not be verified');
    }

    const { credential, aaguid } = verification.registrationInfo;

    // Reject duplicate credentials
    const existing = await this.prisma.passkeyCredential.findUnique({
      where: { credentialId: credential.id },
    });
    if (existing) {
      throw new BadRequestException('This passkey is already registered to an account');
    }

    const transports: string[] = (response?.response?.transports as string[]) ?? [];

    await this.prisma.passkeyCredential.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        deviceName: (deviceName || '').trim() || 'My device',
        aaguid: aaguid || null,
        transports,
      },
    });

    return { ok: true, message: 'Passkey set up successfully' };
  }

  // ── Authentication ──────────────────────────────────────────────────────

  async getAuthenticationOptions() {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'required',
      // No allowCredentials → discoverable credential (user's device shows the picker)
    });

    cacheSet(`passkey:auth:${options.challenge}`, options.challenge, 5 * 60 * 1000);
    return options;
  }

  async confirmAuthentication(response: any) {
    // Extract the challenge the browser signed
    let challengeFromClient: string;
    try {
      const clientData = JSON.parse(
        Buffer.from(response.response.clientDataJSON, 'base64url').toString(),
      );
      challengeFromClient = clientData.challenge;
    } catch {
      throw new BadRequestException('Invalid credential format');
    }

    const storedChallenge = cacheGet<string>(`passkey:auth:${challengeFromClient}`);
    if (!storedChallenge) {
      throw new UnauthorizedException('Authentication challenge expired. Please try again.');
    }
    cacheBust(`passkey:auth:${challengeFromClient}`);

    // Look up which user owns this credential
    const passkeyRecord = await this.prisma.passkeyCredential.findUnique({
      where: { credentialId: response.id },
    });
    if (!passkeyRecord) {
      throw new UnauthorizedException('Passkey not recognized. Use email login instead.');
    }

    let verification: any;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: storedChallenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        credential: {
          id: passkeyRecord.credentialId,
          publicKey: new Uint8Array(passkeyRecord.publicKey),
          counter: Number(passkeyRecord.counter),
          transports: passkeyRecord.transports as any[],
        },
      });
    } catch (err: any) {
      throw new UnauthorizedException(`Authentication failed: ${err?.message || 'Unknown error'}`);
    }

    if (!verification.verified || !verification.authenticationInfo) {
      throw new UnauthorizedException('Authentication failed');
    }

    // Update the signature counter (replay-attack prevention)
    await this.prisma.passkeyCredential.update({
      where: { id: passkeyRecord.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });

    // Re-use the existing session creation logic from AuthService
    return this.auth.createSessionForUser(passkeyRecord.userId);
  }

  // ── Manage ──────────────────────────────────────────────────────────────

  async listPasskeys(userId: string) {
    return this.prisma.passkeyCredential.findMany({
      where: { userId },
      select: {
        id: true,
        deviceName: true,
        createdAt: true,
        lastUsedAt: true,
        transports: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removePasskey(userId: string, passkeyId: string) {
    const pk = await this.prisma.passkeyCredential.findFirst({
      where: { id: passkeyId, userId },
    });
    if (!pk) throw new BadRequestException('Passkey not found');
    await this.prisma.passkeyCredential.delete({ where: { id: passkeyId } });
    return { ok: true };
  }
}
