import axios from 'axios';

import { PlatformIdentityService } from './platform-identity.service';

jest.mock('axios');

interface HttpGetMock {
  get: jest.Mock;
}

describe('PlatformIdentityService', () => {
  const mockedCreate = jest.spyOn(axios, 'create');

  const buildHttpMock = (): HttpGetMock => ({ get: jest.fn() });

  const meResponse = (tenants: { id: string; slug: string }[]) => ({
    data: { data: { tenants } },
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('mapeia tenants[].slug do /auth/me para as chaves do catálogo, ignorando tenant sem correspondência', async () => {
    const httpMock = buildHttpMock();
    httpMock.get.mockResolvedValue(
      meResponse([
        { id: 'tenant-suprema', slug: 'suprema-bet' },
        { id: 'tenant-desconhecido', slug: 'nao-existe-no-catalogo' },
      ]),
    );
    mockedCreate.mockReturnValue(httpMock as never);
    const service = new PlatformIdentityService({ apiUrl: 'http://localhost:3000' });

    const brands = await service.resolveAccessibleBrands('Bearer token-a');

    expect(brands).toEqual([{ brand: 'suprema', tenantId: 'tenant-suprema' }]);
  });

  it('mesmo token dentro de 60s faz 1 request; tokens diferentes fazem 2', async () => {
    const httpMock = buildHttpMock();
    httpMock.get.mockResolvedValue(meResponse([{ id: 'tenant-suprema', slug: 'suprema-bet' }]));
    mockedCreate.mockReturnValue(httpMock as never);
    const service = new PlatformIdentityService({ apiUrl: 'http://localhost:3000' });

    await service.resolveAccessibleBrands('Bearer token-a');
    await service.resolveAccessibleBrands('Bearer token-a');
    expect(httpMock.get).toHaveBeenCalledTimes(1);

    await service.resolveAccessibleBrands('Bearer token-b');
    expect(httpMock.get).toHaveBeenCalledTimes(2);
  });

  it('cache expira após 60s — nova chamada HTTP', async () => {
    jest.useFakeTimers();
    const httpMock = buildHttpMock();
    httpMock.get.mockResolvedValue(meResponse([{ id: 'tenant-suprema', slug: 'suprema-bet' }]));
    mockedCreate.mockReturnValue(httpMock as never);
    const service = new PlatformIdentityService({ apiUrl: 'http://localhost:3000' });

    await service.resolveAccessibleBrands('Bearer token-a');
    jest.advanceTimersByTime(60_001);
    await service.resolveAccessibleBrands('Bearer token-a');

    expect(httpMock.get).toHaveBeenCalledTimes(2);
  });

  it('nunca loga o token nem o header Authorization em falha', async () => {
    const httpMock = buildHttpMock();
    httpMock.get.mockRejectedValue(new Error('timeout'));
    mockedCreate.mockReturnValue(httpMock as never);
    const service = new PlatformIdentityService({ apiUrl: 'http://localhost:3000' });
    const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

    await expect(service.resolveAccessibleBrands('Bearer super-secreto')).rejects.toThrow(
      'Não foi possível validar as marcas do usuário',
    );

    for (const call of errorSpy.mock.calls) {
      expect(String(call[0])).not.toContain('super-secreto');
      expect(String(call[0]).toLowerCase()).not.toContain('authorization');
    }
  });

  it('falha do /auth/me propaga como ServiceUnavailableException, nunca o erro cru do axios', async () => {
    const httpMock = buildHttpMock();
    httpMock.get.mockRejectedValue(new Error('ECONNRESET'));
    mockedCreate.mockReturnValue(httpMock as never);
    const service = new PlatformIdentityService({ apiUrl: 'http://localhost:3000' });

    await expect(service.resolveAccessibleBrands('Bearer token-a')).rejects.toMatchObject({
      name: 'ServiceUnavailableException',
    });
  });
});
