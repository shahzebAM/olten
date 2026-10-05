import { Injectable, Logger, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type SessionAdmin = {
  id: number;
  username: string;
  password: string;
  role: string;
  status?: string;
  modules: unknown;
};

const SESSION_SECONDS = 8 * 60 * 60;
const TOKEN_HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

@Injectable()
export class AuthSessionService implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();
  private readonly secret: Buffer;

  constructor() {
    const configuredSecret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
    if (configuredSecret && Buffer.byteLength(configuredSecret) < 32) {
      throw new Error('SESSION_SECRET must contain at least 32 bytes.');
    }
    this.secret = configuredSecret ? Buffer.from(configuredSecret) : randomBytes(64);
    if (!configuredSecret) {
      new Logger(AuthSessionService.name).warn('SESSION_SECRET is unset. Login sessions expire on restart; configure one shared secret for multiple backend instances.');
    }
  }

  issue(admin: SessionAdmin) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + SESSION_SECONDS;
    const payload = Buffer.from(JSON.stringify({
      iss: 'olten', sub: admin.id, iat: issuedAt, exp: expiresAt,
      version: this.passwordVersion(admin.password),
    })).toString('base64url');
    const unsignedToken = `${TOKEN_HEADER}.${payload}`;
    return { accessToken: `${unsignedToken}.${this.sign(unsignedToken)}`, expiresAt };
  }

  async authenticate(authorization: unknown): Promise<Omit<SessionAdmin, 'password'>> {
    const unauthorized = () => new UnauthorizedException('Your session is missing or expired. Please log in again.');
    if (typeof authorization !== 'string' || authorization.length > 4096) throw unauthorized();
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
    if (!match) throw unauthorized();
    const [header, payload, signature] = match[1].split('.');
    if (header !== TOKEN_HEADER) throw unauthorized();
    const expected = Buffer.from(this.sign(`${header}.${payload}`), 'base64url');
    const actual = Buffer.from(signature, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw unauthorized();

    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch { throw unauthorized(); }
    const now = Math.floor(Date.now() / 1000);
    if (!claims || claims.iss !== 'olten' || !Number.isSafeInteger(claims.sub) || Number(claims.sub) < 1
      || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
      || Number(claims.exp) <= now || Number(claims.iat) > now + 30
      || Number(claims.exp) - Number(claims.iat) !== SESSION_SECONDS
      || typeof claims.version !== 'string') throw unauthorized();

    const admin = await this.prisma.admin.findUnique({
      where: { id: Number(claims.sub) },
      select: { id: true, username: true, password: true, role: true, status: true, modules: true },
    });
    if (!admin || admin.status !== 'Active' || claims.version !== this.passwordVersion(admin.password)) throw unauthorized();
    const { password: _password, ...identity } = admin;
    return identity;
  }

  async companyExists(name: string) {
    return !!await this.prisma.company.findUnique({ where: { name }, select: { id: true } });
  }

  private sign(value: string) {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  private passwordVersion(password: string) {
    return createHmac('sha256', this.secret).update(`password:${password}`).digest('base64url');
  }

  async onModuleDestroy() { await this.prisma.$disconnect(); }
}
