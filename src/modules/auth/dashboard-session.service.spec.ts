import { DataSource } from 'typeorm';
import { dashboardCredentialVersion, DashboardSessionService } from './dashboard-session.service';
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
    delete process.env.DASHBOARD_LOGIN_EMAIL;
    delete process.env.DASHBOARD_LOGIN_PASSWORD;
    delete process.env.DASHBOARD_SECONDARY_LOGIN_EMAIL;
    delete process.env.DASHBOARD_SECONDARY_LOGIN_PASSWORD;
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

  it('keeps both login accounts independent and invalidates only the changed credentials', async () => {
    process.env.DASHBOARD_LOGIN_EMAIL = 'admin@example.com';
    process.env.DASHBOARD_LOGIN_PASSWORD = 'existing-password';
    process.env.DASHBOARD_SECONDARY_LOGIN_EMAIL = 'api@example.com';
    process.env.DASHBOARD_SECONDARY_LOGIN_PASSWORD = 'secondary-password';
    const primary = await service.issue('admin', dashboardCredentialVersion('admin@example.com', 'existing-password'));
    const secondary = await service.issue(
      'operator',
      dashboardCredentialVersion('api@example.com', 'secondary-password'),
    );

    await expect(service.resolve(primary.token)).resolves.toBe('admin');
    await expect(service.resolve(secondary.token)).resolves.toBe('operator');

    process.env.DASHBOARD_SECONDARY_LOGIN_PASSWORD = 'changed-password';
    await expect(service.resolve(primary.token)).resolves.toBe('admin');
    await expect(service.resolve(secondary.token)).rejects.toThrow('session ended');
  });
});
