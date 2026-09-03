import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';

import { AuditInterceptor } from './audit.interceptor';

describe('AuditInterceptor', () => {
  const buildRepository = () => ({ insert: jest.fn().mockResolvedValue(undefined) });
  const buildConfig = (): ConfigService =>
    ({ getOrThrow: jest.fn().mockReturnValue('api/v1') }) as unknown as ConfigService;

  const buildContext = (req: Record<string, unknown>): ExecutionContext =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

  const buildHandler = (response: unknown): CallHandler => ({
    handle: () => of(response),
  });

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('grava action=REGISTER e entity=cash-balance para POST .../register (rota mutação nomeada)', async () => {
    const repository = buildRepository();
    const interceptor = new AuditInterceptor(repository as never, buildConfig());
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/cash-balance/suprema/register',
      headers: { 'user-agent': 'jest' },
      ip: '127.0.0.1',
      user: { sub: 'user-1', tenantId: 'tenant-1', email: 'a@b.com', permissions: [] },
    };

    interceptor.intercept(buildContext(req), buildHandler({ brand: 'suprema' })).subscribe();
    await flush();

    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        action: 'REGISTER',
        entity: 'cash-balance',
        after: { brand: 'suprema' },
      }),
    );
  });

  it('grava after=null para rota 204 (resposta undefined)', async () => {
    const repository = buildRepository();
    const interceptor = new AuditInterceptor(repository as never, buildConfig());
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/cash-balance/suprema/banks/caixa/confirm',
      headers: {},
      user: { sub: 'user-1', tenantId: 'tenant-1', email: 'a@b.com', permissions: [] },
    };

    interceptor.intercept(buildContext(req), buildHandler(undefined)).subscribe();
    await flush();

    expect(repository.insert).toHaveBeenCalledWith(expect.objectContaining({ after: null }));
  });

  it('grava action=RESOLVE para POST reconciliation/items/:id/resolve (reusado pela Conciliação, Fase 17)', async () => {
    const repository = buildRepository();
    const interceptor = new AuditInterceptor(repository as never, buildConfig());
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/reconciliation/items/42/resolve',
      headers: {},
      user: { sub: 'user-1', tenantId: 'tenant-1', email: 'a@b.com', permissions: [] },
    };

    interceptor.intercept(buildContext(req), buildHandler(undefined)).subscribe();
    await flush();

    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RESOLVE', entity: 'reconciliation' }),
    );
  });

  it('grava action=APPLY para POST reconciliation/:brand/corrections/apply (reusado pela Conciliação, Fase 17)', async () => {
    const repository = buildRepository();
    const interceptor = new AuditInterceptor(repository as never, buildConfig());
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/reconciliation/suprema/corrections/apply',
      headers: {},
      user: { sub: 'user-1', tenantId: 'tenant-1', email: 'a@b.com', permissions: [] },
    };

    interceptor.intercept(buildContext(req), buildHandler({})).subscribe();
    await flush();

    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'APPLY', entity: 'reconciliation' }),
    );
  });

  it('não grava nada para método GET (não é mutação)', async () => {
    const repository = buildRepository();
    const interceptor = new AuditInterceptor(repository as never, buildConfig());
    const req = {
      method: 'GET',
      originalUrl: '/api/v1/cash-balance/summary',
      headers: {},
      user: { sub: 'user-1', tenantId: 'tenant-1', email: 'a@b.com', permissions: [] },
    };

    interceptor.intercept(buildContext(req), buildHandler({ ok: true })).subscribe();
    await flush();

    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('não grava nada sem usuário autenticado no request', async () => {
    const repository = buildRepository();
    const interceptor = new AuditInterceptor(repository as never, buildConfig());
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/cash-balance/suprema/register',
      headers: {},
    };

    interceptor.intercept(buildContext(req), buildHandler({ ok: true })).subscribe();
    await flush();

    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('falha de auditoria não propaga erro (fire-and-forget)', async () => {
    const repository = { insert: jest.fn().mockRejectedValue(new Error('db fora')) };
    const interceptor = new AuditInterceptor(repository as never, buildConfig());
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/cash-balance/suprema/register',
      headers: {},
      user: { sub: 'user-1', tenantId: 'tenant-1', email: 'a@b.com', permissions: [] },
    };

    let observedError: unknown;
    interceptor.intercept(buildContext(req), buildHandler({ ok: true })).subscribe({
      error: (error: unknown) => {
        observedError = error;
      },
    });
    await flush();

    expect(observedError).toBeUndefined();
  });

  it('action cai para o método HTTP mapeado quando o último segmento não é nomeado (ex.: GET summary → só não audita; PATCH genérico → UPDATE)', async () => {
    const repository = buildRepository();
    const interceptor = new AuditInterceptor(repository as never, buildConfig());
    const req = {
      method: 'PATCH',
      originalUrl: '/api/v1/cash-balance/suprema',
      headers: {},
      user: { sub: 'user-1', tenantId: 'tenant-1', email: 'a@b.com', permissions: [] },
    };

    interceptor.intercept(buildContext(req), buildHandler({ ok: true })).subscribe();
    await flush();

    expect(repository.insert).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }));
  });
});
