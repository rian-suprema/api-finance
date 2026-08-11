import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { User } from './entities/user.entity';
import { UsersService } from './users.service';

/**
 * Unit tests do UsersService: regras de negócio isoladas — o repositório é
 * test double. Rápidos (sem I/O), rodam a cada save.
 */
describe('UsersService', () => {
  let service: UsersService;

  const usersRepo = {
    create: jest.fn((input: Partial<User>) => input),
    save: jest.fn((input: Partial<User>) => Promise.resolve({ id: 1, ...input })),
    findOne: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: getRepositoryToken(User), useValue: usersRepo }],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  describe('create — unicidade de username', () => {
    it('cria quando o username não existe', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      const user = await service.create({ username: 'theUser' });

      expect(user.username).toBe('theUser');
      expect(usersRepo.save).toHaveBeenCalled();
    });

    it('username duplicado: ConflictException, sem persistir', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 1, username: 'theUser' });

      await expect(service.create({ username: 'theUser' })).rejects.toThrow(ConflictException);
      expect(usersRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('createWithList', () => {
    it('cria em ordem e devolve todos', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      const created = await service.createWithList([{ username: 'a' }, { username: 'b' }]);

      expect(created).toHaveLength(2);
      expect(usersRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('findByUsername', () => {
    it('devolve o usuário existente', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 7, username: 'theUser' });

      const user = await service.findByUsername('theUser');

      expect(user.id).toBe(7);
    });

    it('inexistente: NotFoundException', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.findByUsername('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('aplica o patch sobre o usuário carregado', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 7, username: 'theUser', email: 'old@email.com' });

      await service.update('theUser', { email: 'new@email.com' });

      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7, email: 'new@email.com' }),
      );
    });
  });

  describe('remove', () => {
    it('remove o usuário existente', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 7, username: 'theUser' });

      await service.remove('theUser');

      expect(usersRepo.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    });

    it('inexistente: NotFoundException (e não remove nada)', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('ghost')).rejects.toThrow(NotFoundException);
      expect(usersRepo.remove).not.toHaveBeenCalled();
    });
  });
});
