import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';

import { User } from './entities/user.entity';
import { UsersService } from './users.service';

/**
 * Unit tests do UsersService: regras de negócio isoladas — o repositório é
 * test double. Rápidos (sem I/O), rodam a cada save.
 *
 * Multi-tenancy: além do comportamento, os testes fixam que TODA query
 * carrega o filtro de tenant — remover o filtro de um findOne quebra aqui,
 * antes de virar vazamento entre tenants.
 */
describe('UsersService', () => {
  let service: UsersService;

  const TENANT = 'tenant-a';

  const usersRepo = {
    create: jest.fn((input: Partial<User>) => input),
    save: jest.fn((input: Partial<User>) => Promise.resolve({ id: 1, ...input })),
    findOne: jest.fn(),
    remove: jest.fn(),
  };

  // Fora de uma requisição não há contexto de tenant → tenantManager cai no
  // manager default do DataSource. O mock devolve o repositório acima; assim o
  // teste unitário fica no comportamento do service, não na transação.
  const dataSource = { manager: { getRepository: jest.fn(() => usersRepo) } };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: getDataSourceToken(), useValue: dataSource }],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  describe('create — unicidade de username POR TENANT', () => {
    it('cria quando o username não existe no tenant, gravando o tenantId do claim', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      const user = await service.create(TENANT, { username: 'theUser' });

      expect(user.username).toBe('theUser');
      // a conferência de unicidade é DENTRO da fatia do tenant...
      expect(usersRepo.findOne).toHaveBeenCalledWith({
        where: { tenantId: TENANT, username: 'theUser' },
      });
      // ...e o registro nasce carimbado com o tenant
      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT, username: 'theUser' }),
      );
    });

    it('username duplicado NO MESMO tenant: ConflictException, sem persistir', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 1, tenantId: TENANT, username: 'theUser' });

      await expect(service.create(TENANT, { username: 'theUser' })).rejects.toThrow(
        ConflictException,
      );
      expect(usersRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('createWithList', () => {
    it('cria em ordem e devolve todos, todos no mesmo tenant', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      const created = await service.createWithList(TENANT, [{ username: 'a' }, { username: 'b' }]);

      expect(created).toHaveLength(2);
      expect(usersRepo.save).toHaveBeenCalledTimes(2);
      expect(usersRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ tenantId: TENANT }),
      );
    });
  });

  describe('findByUsername', () => {
    it('busca SEMPRE filtrando pelo tenant do claim', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 7, tenantId: TENANT, username: 'theUser' });

      const user = await service.findByUsername(TENANT, 'theUser');

      expect(user.id).toBe(7);
      expect(usersRepo.findOne).toHaveBeenCalledWith({
        where: { tenantId: TENANT, username: 'theUser' },
      });
    });

    it('inexistente NO TENANT: NotFoundException (mesmo que exista em outro)', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.findByUsername(TENANT, 'ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('aplica o patch sobre o usuário carregado dentro do tenant', async () => {
      usersRepo.findOne.mockResolvedValue({
        id: 7,
        tenantId: TENANT,
        username: 'theUser',
        email: 'old@email.com',
      });

      await service.update(TENANT, 'theUser', { email: 'new@email.com' });

      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7, email: 'new@email.com' }),
      );
    });
  });

  describe('remove', () => {
    it('remove o usuário existente do tenant', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 7, tenantId: TENANT, username: 'theUser' });

      await service.remove(TENANT, 'theUser');

      expect(usersRepo.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    });

    it('inexistente no tenant: NotFoundException (e não remove nada)', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.remove(TENANT, 'ghost')).rejects.toThrow(NotFoundException);
      expect(usersRepo.remove).not.toHaveBeenCalled();
    });
  });
});
