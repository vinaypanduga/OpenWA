import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { DashboardSession } from './entities/dashboard-session.entity';

export const dashboardTokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
export const DASHBOARD_SESSION_PREFIX = 'owa_ds_';

@Injectable()
export class DashboardSessionService {
  // Serialize sign-ins on this single-server SQLite deployment, including same-millisecond logins.
  private issuance: Promise<unknown> = Promise.resolve();

  constructor(@InjectRepository(DashboardSession, 'main') private readonly sessions: Repository<DashboardSession>) {}

  private credentialVersion(): string {
    return dashboardTokenHash(
      JSON.stringify([
        process.env.DASHBOARD_LOGIN_EMAIL?.trim().toLowerCase(),
        process.env.DASHBOARD_LOGIN_PASSWORD,
        process.env.API_KEY_PEPPER,
      ]),
    );
  }

  issue(apiKeyId: string): Promise<{ token: string; evicted: string[] }> {
    const result = this.issuance.then(() =>
      this.sessions.manager.transaction(async manager => {
        const repository = manager.getRepository(DashboardSession);
        const existing = await repository.find({ order: { id: 'ASC' } });
        const now = Date.now();
        const version = this.credentialVersion();
        const expired = existing.filter(row => row.expiresAt.getTime() <= now || row.credentialVersion !== version);
        const live = existing.filter(row => !expired.includes(row));
        const removed = [...expired, ...live.slice(0, Math.max(0, live.length - 2))];
        if (removed.length) await repository.delete(removed.map(row => row.id));
        const token = DASHBOARD_SESSION_PREFIX + randomBytes(32).toString('hex');
        await repository.save(
          repository.create({
            apiKeyId,
            tokenHash: dashboardTokenHash(token),
            credentialVersion: version,
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
    if (!row || row.expiresAt.getTime() <= Date.now() || row.credentialVersion !== this.credentialVersion()) {
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
