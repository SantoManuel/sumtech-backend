import { buildRouterProfileName, buildSymmetricRateLimit } from './router-profile-name.util';

describe('buildRouterProfileName', () => {
  it('construye el nombre determinístico a partir de la velocidad', () => {
    expect(buildRouterProfileName(50)).toBe('Sumtech-50Mbps');
    expect(buildRouterProfileName(100)).toBe('Sumtech-100Mbps');
  });

  it('dos planes con la misma velocidad producen el mismo nombre (comparten perfil)', () => {
    expect(buildRouterProfileName(50)).toBe(buildRouterProfileName(50));
  });

  it('velocidades distintas producen nombres distintos', () => {
    expect(buildRouterProfileName(50)).not.toBe(buildRouterProfileName(100));
  });
});

describe('buildSymmetricRateLimit', () => {
  it('construye "rx/tx" iguales, ya que los planes de Sumtech son simétricos', () => {
    expect(buildSymmetricRateLimit(50)).toBe('50M/50M');
    expect(buildSymmetricRateLimit(1000)).toBe('1000M/1000M');
  });
});
