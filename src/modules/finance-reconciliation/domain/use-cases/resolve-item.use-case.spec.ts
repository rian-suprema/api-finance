import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { ReconciliationItemStatus } from '../../reconciliation.enums';
import { ResolveItemUseCase } from './resolve-item.use-case';

describe('ResolveItemUseCase', () => {
  const OPEN_ITEM = { id: 1, brand: 'suprema', status: ReconciliationItemStatus.OPEN };

  const buildRepository = (overrides: Record<string, unknown> = {}) => ({
    findItemById: jest.fn().mockResolvedValue(OPEN_ITEM),
    resolveItem: jest.fn().mockResolvedValue(undefined),
    reopenItem: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  describe('resolve', () => {
    it('nota só com espaços (10 caracteres) passa no tamanho bruto mas é recusada depois do trim', async () => {
      const useCase = new ResolveItemUseCase(buildRepository() as never);

      await expect(
        useCase.resolve({
          id: 1,
          note: '          ',
          userId: 'u1',
          allowedBrands: ['suprema'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('item inexistente → NotFoundException', async () => {
      const useCase = new ResolveItemUseCase(
        buildRepository({ findItemById: jest.fn().mockResolvedValue(null) }) as never,
      );

      await expect(
        useCase.resolve({
          id: 999,
          note: 'Nota válida com mais de dez caracteres.',
          userId: 'u1',
          allowedBrands: ['suprema'],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('marca do item fora das acessíveis → ForbiddenException (autorização pelo dado, não pela URL)', async () => {
      const useCase = new ResolveItemUseCase(buildRepository() as never);

      await expect(
        useCase.resolve({
          id: 1,
          note: 'Nota válida com mais de dez caracteres.',
          userId: 'u1',
          allowedBrands: ['ultra', 'maxima'],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('item já RESOLVED → ConflictException', async () => {
      const repository = buildRepository({
        findItemById: jest
          .fn()
          .mockResolvedValue({ ...OPEN_ITEM, status: ReconciliationItemStatus.RESOLVED }),
      });
      const useCase = new ResolveItemUseCase(repository as never);

      await expect(
        useCase.resolve({
          id: 1,
          note: 'Segunda tentativa de tratar a mesma pendência.',
          userId: 'u1',
          allowedBrands: ['suprema'],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('happy path → grava a nota já cortada (trim) com o autor', async () => {
      const repository = buildRepository();
      const useCase = new ResolveItemUseCase(repository as never);

      await useCase.resolve({
        id: 1,
        note: '  Nota válida com espaço nas pontas.  ',
        userId: 'u1',
        allowedBrands: ['suprema'],
      });

      expect(repository.resolveItem).toHaveBeenCalledWith({
        id: 1,
        note: 'Nota válida com espaço nas pontas.',
        userId: 'u1',
      });
    });
  });

  describe('reopen', () => {
    it('item inexistente → NotFoundException', async () => {
      const useCase = new ResolveItemUseCase(
        buildRepository({ findItemById: jest.fn().mockResolvedValue(null) }) as never,
      );

      await expect(useCase.reopen({ id: 999, allowedBrands: ['suprema'] })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('marca do item fora das acessíveis → ForbiddenException', async () => {
      const useCase = new ResolveItemUseCase(buildRepository() as never);

      await expect(useCase.reopen({ id: 1, allowedBrands: ['ultra'] })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('item já OPEN → no-op bem-sucedido, sem 409 (§3.7)', async () => {
      const repository = buildRepository();
      const useCase = new ResolveItemUseCase(repository as never);

      await useCase.reopen({ id: 1, allowedBrands: ['suprema'] });

      expect(repository.reopenItem).toHaveBeenCalledWith(1);
    });
  });
});
