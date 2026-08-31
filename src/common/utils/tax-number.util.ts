/**
 * Formatação de CPF/CNPJ para saída de API.
 *
 * ── Por que o documento sai completo ────────────────────────────────────────
 * O desenho original mascarava (`***.456.789-**`), com o argumento de que nome e
 * EndToEnd bastam para achar a operação **no banco**. Bastam. Só que a pendência
 * que mais custa tratar é o depósito que está no banco e **não está na
 * plataforma**: aí não existe registro do lado da plataforma, logo não existe
 * `client_id` da BetConstruct para exibir, e a única identidade disponível é o
 * documento da contraparte. Com ele mascarado, o operador não tem como achar o
 * jogador no backoffice da BC.
 *
 * O caminho correto é resolver documento → `client_id` no data warehouse e
 * exibir o id do jogador em vez do documento. A view existe
 * (`pii_compliance.vw_player_pii`, com `brand`, `client_id`, `cpf`,
 * `cpf_effective`) e a credencial do módulo está sem permissão
 * (`ACCESS_DENIED`); em `dw_bet` não há documento em nenhuma tabela. Enquanto o
 * grant não sair, o documento completo é o que destrava o trabalho.
 *
 * Decisão de produto do Etiene em 2026-08-10, ciente de que expõe dado pessoal
 * na tela. O endpoint continua exigindo autenticação e é filtrado por marca via
 * `GET /auth/me`. A regra de nunca logar o documento continua valendo.
 */
export function formatTaxNumber(value: string | null | undefined): string | null {
  if (!value) return null;

  const digits = value.replace(/\D/g, '');

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }

  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }

  // Fora dos dois formatos conhecidos, devolve como veio: inventar pontuação
  // esconderia documento truncado ou sujo na origem.
  return value;
}
