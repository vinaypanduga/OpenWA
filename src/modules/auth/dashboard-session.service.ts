import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { DashboardSession } from './entities/dashboard-session.entity';

export const dashboardTokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
export const DASHBOARD_SESSION_PREFIX = 'owa_ds_';

export function dashboardCredentialVersion(email?: string, password?: string): string {
  return dashboardTokenHash(JSON.stringify([email?.trim().toLowerCase(), password, process.env.API_KEY_PEPPER]));
}

@Injectable()
export class DashboardSessionService {
  // Serialize sign-ins on this single-server SQLite deployment, including same-millisecond logins.
  private issuance: Promise<unknown> = Promise.resolve();

  constructor(@InjectRepository(DashboardSession, 'main') private readonly sessions: Repository<DashboardSession>) {}

  private credentialVersions(): Set<string> {
    // Preserve the original single-login version even in isolated tests or partially configured
    // development environments where the primary pair is absent.
    const versions = new Set<string>([
      dashboardCredentialVersion(process.env.DASHBOARD_LOGIN_EMAIL, process.env.DASHBOARD_LOGIN_PASSWORD),
    ]);
    const add = (email?: string, password?: string) => {
      if (email?.trim() && password) versions.add(dashboardCredentialVersion(email, password));
    };
    add(process.env.DASHBOARD_SECONDARY_LOGIN_EMAIL, process.env.DASHBOARD_SECONDARY_LOGIN_PASSWORD);
    return versions;
  }

  issue(
    apiKeyId: string,
    credentialVersion = dashboardCredentialVersion(
      process.env.DASHBOARD_LOGIN_EMAIL,
      process.env.DASHBOARD_LOGIN_PASSWORD,
    ),
  ): Promise<{ token: string; evicted: string[] }> {
    const result = this.issuance.then(() =>
      this.sessions.manager.transaction(async manager => {
        const repository = manager.getRepository(DashboardSession);
        const existing = await repository.find({ order: { id: 'ASC' } });
        const now = Date.now();
        const validVersions = this.credentialVersions();
        const expired = existing.filter(
          row => row.expiresAt.getTime() <= now || !validVersions.has(row.credentialVersion),
        );
        const liveForAccount = existing.filter(row => !expired.includes(row) && row.apiKeyId === apiKeyId);
        const removed = [...expired, ...liveForAccount.slice(0, Math.max(0, liveForAccount.length - 2))];
        if (removed.length) await repository.delete(removed.map(row => row.id));
        const token = DASHBOARD_SESSION_PREFIX + randomBytes(32).toString('hex');
        await repository.save(
          repository.create({
            apiKeyId,
            tokenHash: dashboardTokenHash(token),
            credentialVersion,
            expiresAt: new Date(now + 30 * 86_400_000),
          }),
        );
        return { token, evicted: removed.map(row => row.tokenHash) };
      }),
    );
    this.issuance = result.catch(() => undefined);
    return result;
  }

  async resolve(token: string): Promise<string> {
    const row = await this.sessions.findOne({ where: { tokenHash: dashboardTokenHash(token) } });
    if (!row || row.expiresAt.getTime() <= Date.now() || !this.credentialVersions().has(row.credentialVersion)) {
      throw new UnauthorizedException('Your dashboard session ended. Please sign in again.');
    }
    return row.apiKeyId;
  }

  async revoke(token: string): Promise<void> {
    if (token.startsWith(DASHBOARD_SESSION_PREFIX)) {
      await this.sessions.delete({ tokenHash: dashboardTokenHash(token) });
    }
  }
}
