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
export const PETSHOP_USERS = {
  READ: 'petshop.users.read',
  CREATE: 'petshop.users.create',
  EDIT: 'petshop.users.edit',
  DELETE: 'petshop.users.delete',
} as const;
