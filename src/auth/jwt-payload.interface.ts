/**
 * Claims do JWT emitido pela plataforma SayPlus (contrato de auth consumido).
 *
 * Este módulo NÃO emite tokens — apenas valida (RS256, chave pública) e lê
 * estes claims. Quem autentica, autoriza concessões e emite é a SayPlus.
 */
export interface JwtPayload {
  /** Identificador do usuário na plataforma (claim `sub`). */
  sub: string;
  email: string;
  /**
   * Tenant do usuário — a ÚNICA fonte de tenant aceita pelo módulo.
   * Nunca aceitar tenant vindo de body, query ou header (x-* de proxy é
   * informativo, não autoritativo).
   */
  tenantId: string;
  /**
   * Codes de permissão concedidos (strings opacas para o módulo, ex.:
   * `finance.reconciliation.read`). A concessão vive no catálogo da SayPlus.
   */
  permissions: string[];
}
