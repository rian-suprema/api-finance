/**
 * Codes de permissão que este módulo consome do catálogo SayPlus.
 *
 * Convenção canônica da plataforma: `modulo.recurso.acao`, com verbos
 * `read | create | edit | delete` (é `edit`, nunca `update`). Os codes são
 * strings opacas para o módulo: quem os concede a usuários/perfis é o
 * catálogo da SayPlus, em runtime. Este arquivo é o ÚNICO lugar onde os
 * codes existem como literal — rotas usam as constantes.
 *
 * ⚠️ Cada code daqui precisa estar REGISTRADO no catálogo SayPlus antes da
 * integração real — code não registrado nunca aparece em token emitido.
 */
export const FINANCE_CASH_BALANCE = {
  SUMMARY_READ: 'finance.cash-balance.summary.read',
  BANKS_READ: 'finance.cash-balance.banks.read',
  BANKS_CONFIRM: 'finance.cash-balance.banks.confirm',
  REGISTER_CREATE: 'finance.cash-balance.register.create',
} as const;

export const FINANCE_RECONCILIATION = {
  READ: 'finance.reconciliation.read',
  RUN: 'finance.reconciliation.run',
  RESOLVE: 'finance.reconciliation.resolve',
} as const;
