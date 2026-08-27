import { AuthValidateController } from './auth-validate.controller';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
import { AuthService } from './auth.service';

describe('AuthValidateController', () => {
  const authenticateDashboard = jest.fn();
  const controller = new AuthValidateController({ authenticateDashboard } as unknown as AuthService);

  const makeKey = (over: Partial<ApiKey> = {}): ApiKey =>
    ({ id: 'k1', role: ApiKeyRole.OPERATOR, isActive: true, allowedIps: null, ...over }) as ApiKey;

  it('reports the guard-validated key as valid, echoing its role', () => {
    expect(controller.validate(makeKey({ role: ApiKeyRole.ADMIN }))).toEqual({
      valid: true,
      role: ApiKeyRole.ADMIN,
    });
  });

  it('returns valid:true for an IP-restricted key (no IP-less re-validation false negative)', () => {
    // The global guard already validated this key against the real client IP and attached it.
    // The handler must NOT re-validate without an IP, which previously fail-closed and wrongly
    // reported valid:false for any key carrying an allowedIps restriction.
    const key = makeKey({ allowedIps: ['10.0.0.0/24'] });
    expect(controller.validate(key)).toEqual({ valid: true, role: key.role });
  });

  it('returns valid:false when no key is attached (defense-in-depth)', () => {
    expect(controller.validate(undefined)).toEqual({ valid: false });
  });

  it('exchanges dashboard credentials through AuthService without creating a key', async () => {
    authenticateDashboard.mockResolvedValueOnce({ apiKey: 'existing-key', role: ApiKeyRole.ADMIN });

    await expect(
      controller.dashboardLogin({ email: 'admin@example.com', password: 'correct-password' }),
    ).resolves.toEqual({ apiKey: 'existing-key', role: ApiKeyRole.ADMIN });
    expect(authenticateDashboard).toHaveBeenCalledWith('admin@example.com', 'correct-password');
  });
});
