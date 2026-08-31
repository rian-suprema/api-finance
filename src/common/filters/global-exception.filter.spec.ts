import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';

import { GlobalExceptionFilter } from './global-exception.filter';

function buildHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { method: 'GET', url: '/test' };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('GlobalExceptionFilter', () => {
  it('preserva campo extra do payload da exceção', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = buildHost();

    filter.catch(new BadRequestException({ message: 'x', pendingBanks: ['a', 'b'] }), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: 'BAD_REQUEST',
      message: 'x',
      pendingBanks: ['a', 'b'],
    });
  });

  it('não quebra o caso simples — sem chaves extras vazias', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = buildHost();

    filter.catch(new NotFoundException('User not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ code: 'NOT_FOUND', message: 'User not found' });
  });

  it('erro do ValidationPipe (message: string[]) continua unido por "; "', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = buildHost();

    filter.catch(
      new BadRequestException({ message: ['campo a é obrigatório', 'campo b é inválido'] }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: 'BAD_REQUEST',
      message: 'campo a é obrigatório; campo b é inválido',
    });
  });
});
