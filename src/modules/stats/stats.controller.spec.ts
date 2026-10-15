import { StatsController } from './stats.controller';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { StatsQueryDto } from './dto/stats-query.dto';
import { validate } from 'class-validator';

// Admins see installation-wide analytics; restricted dashboard identities see only assigned sessions.
describe('StatsController access control', () => {
  it('passes a restricted login session scope into overview analytics', async () => {
    const getOverview = jest.fn().mockResolvedValue({});
    const controller = new StatsController({ getOverview } as never);

    await controller.getOverview({ role: ApiKeyRole.OPERATOR, allowedSessions: ['api-session'] } as never);

    expect(getOverview).toHaveBeenCalledWith(['api-session']);
  });

  it('forwards the optional group filter to the statistics service', async () => {
    const getMessageStats = jest.fn().mockResolvedValue({});
    const controller = new StatsController({ getMessageStats } as never);

    await controller.getMessageStats({ period: '7d', groupId: 'alpha@g.us' }, { role: ApiKeyRole.ADMIN } as never);

    expect(getMessageStats).toHaveBeenCalledWith('7d', ['alpha@g.us'], undefined);
  });

  it('combines the legacy single-group filter with multiple group filters', async () => {
    const getMessageStats = jest.fn().mockResolvedValue({});
    const controller = new StatsController({ getMessageStats } as never);

    await controller.getMessageStats(
      {
        period: '30d',
        groupId: 'alpha@g.us',
        groupIds: ['beta@g.us', 'gamma@g.us'],
      },
      { role: ApiKeyRole.ADMIN } as never,
    );

    expect(getMessageStats).toHaveBeenCalledWith('30d', ['beta@g.us', 'gamma@g.us', 'alpha@g.us'], undefined);
  });

  it('passes a restricted login session scope into every message analytics query', async () => {
    const getMessageStats = jest.fn().mockResolvedValue({});
    const controller = new StatsController({ getMessageStats } as never);

    await controller.getMessageStats({ period: '24h' }, {
      role: ApiKeyRole.OPERATOR,
      allowedSessions: ['api-session'],
    } as never);

    expect(getMessageStats).toHaveBeenCalledWith('24h', undefined, ['api-session']);
  });

  it('rejects an unscoped non-admin instead of exposing installation-wide analytics', async () => {
    const controller = new StatsController({ getMessageStats: jest.fn() } as never);
    await expect(
      controller.getMessageStats({ period: '24h' }, { role: ApiKeyRole.OPERATOR, allowedSessions: null } as never),
    ).rejects.toThrow('Analytics require an administrator or a session-scoped key');
  });
});

describe('StatsQueryDto group filter', () => {
  const errorsFor = (groupId: string) => validate(Object.assign(new StatsQueryDto(), { groupId }));
  const arrayErrorsFor = (groupIds: string[]) => validate(Object.assign(new StatsQueryDto(), { groupIds }));

  it('accepts a WhatsApp group JID', async () => {
    await expect(errorsFor('120363000000000000@g.us')).resolves.toHaveLength(0);
  });

  it.each(['@g.us', 'person@c.us', 'group name@g.us'])('rejects invalid group id %s', async groupId => {
    await expect(errorsFor(groupId)).resolves.not.toHaveLength(0);
  });

  it('accepts multiple WhatsApp group JIDs', async () => {
    await expect(arrayErrorsFor(['alpha@g.us', 'beta@g.us'])).resolves.toHaveLength(0);
  });

  it('rejects an empty or invalid multi-group selection', async () => {
    await expect(arrayErrorsFor([])).resolves.not.toHaveLength(0);
    await expect(arrayErrorsFor(['alpha@g.us', 'person@c.us'])).resolves.not.toHaveLength(0);
  });
});
