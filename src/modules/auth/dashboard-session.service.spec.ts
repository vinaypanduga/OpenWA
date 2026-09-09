import { DataSource } from 'typeorm';
import { DashboardSessionService } from './dashboard-session.service';
import { DashboardSession } from './entities/dashboard-session.entity';

describe('DashboardSessionService', () => {
  let db: DataSource;
  let service: DashboardSessionService;

  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [DashboardSession],
      synchronize: true,
    }).initialize();
    service = new DashboardSessionService(db.getRepository(DashboardSession));
  });
  afterEach(async () => {
    await db.destroy();
  });

  it('revokes the oldest login on the fourth login, preserving the other three', async () => {
    const tokens = [];
    for (let i = 0; i < 4; i++) tokens.push(await service.issue('admin'));
    await expect(service.resolve(tokens[0].token)).rejects.toThrow('session ended');
    for (const session of tokens.slice(1)) await expect(service.resolve(session.token)).resolves.toBe('admin');
    expect(tokens[3].evicted).toHaveLength(1);
    expect(await db.getRepository(DashboardSession).count()).toBe(3);
  });

  it('enforces the cap for concurrent logins and persists across service recreation', async () => {
    const tokens = await Promise.all(Array.from({ length: 8 }, () => service.issue('admin')));
    const restarted = new DashboardSessionService(db.getRepository(DashboardSession));
    for (const session of tokens.slice(0, 5)) await expect(restarted.resolve(session.token)).rejects.toThrow();
    for (const session of tokens.slice(5)) await expect(restarted.resolve(session.token)).resolves.toBe('admin');
    expect(await db.getRepository(DashboardSession).count()).toBe(3);
  });

  it('revokes on logout and rejects expired sessions', async () => {
    const first = await service.issue('admin');
    await service.revoke(first.token);
    await expect(service.resolve(first.token)).rejects.toThrow();
    const second = await service.issue('admin');
    await db
      .getRepository(DashboardSession)
      .createQueryBuilder()
      .update()
      .set({ expiresAt: new Date(0) })
      .execute();
    await expect(service.resolve(second.token)).rejects.toThrow();
    expect((await service.issue('admin')).evicted).toHaveLength(1);
  });
});
