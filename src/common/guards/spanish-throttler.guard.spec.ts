import { ThrottlerGuard } from '@nestjs/throttler';
import { SpanishThrottlerGuard } from './spanish-throttler.guard';

describe('SpanishThrottlerGuard', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let guard: SpanishThrottlerGuard;
  let superCanActivateSpy: jest.SpyInstance;

  beforeEach(() => {
    guard = Object.create(SpanishThrottlerGuard.prototype);
    superCanActivateSpy = jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it('fuera de producción, permite el paso sin invocar la lógica real de throttling', async () => {
    process.env.NODE_ENV = 'development';

    const result = await guard.canActivate({} as any);

    expect(result).toBe(true);
    expect(superCanActivateSpy).not.toHaveBeenCalled();
  });

  it('con NODE_ENV indefinido (por defecto en tests), también permite el paso sin throttling', async () => {
    delete process.env.NODE_ENV;

    const result = await guard.canActivate({} as any);

    expect(result).toBe(true);
    expect(superCanActivateSpy).not.toHaveBeenCalled();
  });

  it('en producción, delega en la lógica real de ThrottlerGuard', async () => {
    process.env.NODE_ENV = 'production';

    const result = await guard.canActivate({} as any);

    expect(result).toBe(true);
    expect(superCanActivateSpy).toHaveBeenCalledTimes(1);
  });
});
