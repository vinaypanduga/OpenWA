import { Reflector } from '@nestjs/core';
import { StatsController } from './stats.controller';
import { REQUIRED_ROLE_KEY } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { StatsQueryDto } from './dto/stats-query.dto';
import { validate } from 'class-validator';

// the global stats routes aggregate across EVERY session and carry no scope param, so the
// ApiKeyGuard's allowedSessions fence doesn't apply. They must require ADMIN so a VIEWER / a
// session-restricted key can't read cross-tenant activity. The per-session route is left ungated:
// it carries :sessionId, so the guard already scopes a restricted key to its own sessions.
describe('StatsController access control', () => {
  const reflector = new Reflector();
  // Opaque-object view of the prototype so the lint unbound-method rule doesn't fire on a
  // metadata-only handler lookup.
  const proto = StatsController.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

  it.each(['getOverview', 'getMessageStats'] as const)('global stats route %s requires ADMIN', method => {
    const role = reflector.get<ApiKeyRole | undefined>(REQUIRED_ROLE_KEY, proto[method]);
    expect(role).toBe(ApiKeyRole.ADMIN);
  });

  it('per-session stats is not globally ADMIN-gated (scope-enforced by its :sessionId param)', () => {
    const role = reflector.get<ApiKeyRole | undefined>(REQUIRED_ROLE_KEY, proto.getSessionStats);
    expect(role).toBeUndefined();
  });

  it('forwards the optional group filter to the statistics service', async () => {
    const getMessageStats = jest.fn().mockResolvedValue({});
    const controller = new StatsController({ getMessageStats } as never);

    await controller.getMessageStats({ period: '7d', groupId: 'alpha@g.us' });

    expect(getMessageStats).toHaveBeenCalledWith('7d', ['alpha@g.us']);
  });

  it('combines the legacy single-group filter with multiple group filters', async () => {
    const getMessageStats = jest.fn().mockResolvedValue({});
    const controller = new StatsController({ getMessageStats } as never);

    await controller.getMessageStats({
      period: '30d',
      groupId: 'alpha@g.us',
      groupIds: ['beta@g.us', 'gamma@g.us'],
    });

    expect(getMessageStats).toHaveBeenCalledWith('30d', ['beta@g.us', 'gamma@g.us', 'alpha@g.us']);
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
