import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

const TRUSTED_DEVICE_COOKIE = 'tomafix_trusted_device';
const TOKEN_BYTES = 32; // 256-bit random token
const EXPIRY_DAYS = 30;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function expiryDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + EXPIRY_DAYS);
  return d;
}

/** Guess a human-readable device label from a User-Agent string */
function deviceNameFromUA(ua: string): string {
  if (!ua) return 'Unknown device';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux device';
  return 'Unknown device';
}

@Injectable()
export class TrustedDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  // ── Register ─────────────────────────────────────────────────────────────

  /**
   * Create a new trusted device token for an already-authenticated user.
   * Returns the raw token to be stored on the client (localStorage/cookie).
   * Only the SHA-256 hash is stored in the database.
   */
  async registerDevice(userId: string, userAgent?: string) {
    const rawToken = randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = hashToken(rawToken);
    const deviceName = deviceNameFromUA(userAgent || '');

    await this.prisma.trustedDevice.create({
      data: {
        userId,
        tokenHash,
        deviceName,
        expiresAt: expiryDate(),
      },
    });

    return { token: rawToken, deviceName, expiresInDays: EXPIRY_DAYS };
  }

  // ── Verify ────────────────────────────────────────────────────────────────

  /**
   * Verify a raw trusted device token.
   * If valid and not expired, update lastUsedAt and return a fresh auth session.
   * The token is automatically refreshed (new expiry) on each successful use.
   */
  async verifyDevice(rawToken: string) {
    if (!rawToken) throw new UnauthorizedException('No device token provided');

    const tokenHash = hashToken(rawToken.trim());
    const record = await this.prisma.trustedDevice.findUnique({ where: { tokenHash } });

    if (!record) {
      throw new UnauthorizedException('Device not recognized. Please log in with email.');
    }
    if (new Date() > record.expiresAt) {
      // Clean up expired token
      await this.prisma.trustedDevice.delete({ where: { id: record.id } }).catch(() => {});
      throw new UnauthorizedException('Device trust has expired. Please log in with email.');
    }

    // Refresh expiry + update lastUsedAt
    await this.prisma.trustedDevice.update({
      where: { id: record.id },
      data: {
        expiresAt: expiryDate(),
        lastUsedAt: new Date(),
      },
    });

    return this.auth.createSessionForUser(record.userId);
  }

  // ── Manage ────────────────────────────────────────────────────────────────

  async listDevices(userId: string) {
    return this.prisma.trustedDevice.findMany({
      where: { userId },
      select: {
        id: true,
        deviceName: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removeDevice(userId: string, deviceId: string) {
    const record = await this.prisma.trustedDevice.findFirst({
      where: { id: deviceId, userId },
    });
    if (!record) throw new BadRequestException('Trusted device not found');
    await this.prisma.trustedDevice.delete({ where: { id: deviceId } });
    return { ok: true };
  }

  /** Remove all trusted devices for this user (e.g. when they revoke all sessions) */
  async removeAllDevices(userId: string) {
    await this.prisma.trustedDevice.deleteMany({ where: { userId } });
    return { ok: true };
  }
}
