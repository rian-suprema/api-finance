import type { PlatformIdentityService } from '../../infrastructure/platform/platform-identity.service';
import type { BrandAccess } from '../cash-balance.types';
import { BrandAccessService } from './brand-access.service';

describe('BrandAccessService', () => {
  const buildIdentity = (brands: BrandAccess[]): PlatformIdentityService =>
    ({
      resolveAccessibleBrands: jest.fn().mockResolvedValue(brands),
    }) as unknown as PlatformIdentityService;

  describe('resolveBrands', () => {
    it('repassa o resultado de PlatformIdentityService.resolveAccessibleBrands sem alterar (o mapeamento tenant→marca é coberto em platform-identity.service.spec.ts)', async () => {
      const identity = buildIdentity([{ brand: 'suprema', tenantId: 'tenant-suprema' }]);
      const service = new BrandAccessService(identity);

      const brands = await service.resolveBrands('Bearer token');

      expect(brands).toEqual([{ brand: 'suprema', tenantId: 'tenant-suprema' }]);
    });
  });

  describe('requireBrand', () => {
    it('marca inexistente no catálogo lança BadRequestException', async () => {
      const identity = buildIdentity([]);
      const service = new BrandAccessService(identity);

      await expect(service.requireBrand('Bearer token', 'inexistente')).rejects.toMatchObject({
        name: 'BadRequestException',
        message: 'Marca não reconhecida',
      });
    });

    it('marca existente no catálogo mas sem vínculo lança ForbiddenException', async () => {
      const identity = buildIdentity([]);
      const service = new BrandAccessService(identity);

      await expect(service.requireBrand('Bearer token', 'suprema')).rejects.toMatchObject({
        name: 'ForbiddenException',
        message: 'Usuário sem acesso a esta marca',
      });
    });

    it('marca existente e com vínculo devolve {brand, tenantId}', async () => {
      const identity = buildIdentity([{ brand: 'suprema', tenantId: 'tenant-suprema' }]);
      const service = new BrandAccessService(identity);

      const access = await service.requireBrand('Bearer token', 'suprema');

      expect(access).toEqual({ brand: 'suprema', tenantId: 'tenant-suprema' });
    });
  });

  describe('resolveReferenceDate', () => {
    it('sem date, devolve o dia anterior em BRT', () => {
      const service = new BrandAccessService(buildIdentity([]));

      const result = service.resolveReferenceDate();

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('com date inválida, lança BadRequestException (400)', () => {
      const service = new BrandAccessService(buildIdentity([]));

      expect(() => service.resolveReferenceDate('não-é-data')).toThrow('Data inválida');
    });
  });

  describe('resolveRange', () => {
    it('sem from/to, devolve os últimos 15 dias terminando ontem', () => {
      const service = new BrandAccessService(buildIdentity([]));

      const range = service.resolveRange();

      const days =
        (new Date(`${range.to}T00:00:00Z`).getTime() -
          new Date(`${range.from}T00:00:00Z`).getTime()) /
          86_400_000 +
        1;
      expect(days).toBe(15);
    });

    it('from > to lança BadRequestException (400)', () => {
      const service = new BrandAccessService(buildIdentity([]));

      expect(() => service.resolveRange('2026-08-20', '2026-08-10')).toThrow(
        'A data inicial não pode ser posterior à final',
      );
    });

    it('intervalo maior que 180 dias lança BadRequestException (400)', () => {
      const service = new BrandAccessService(buildIdentity([]));

      expect(() => service.resolveRange('2026-01-01', '2026-08-01')).toThrow(
        'O intervalo não pode passar de 180 dias',
      );
    });
  });
});
