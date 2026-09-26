// Conventional Commits — https://www.conventionalcommits.org
//
// SEM `ignores`, e isso é decisão medida. O Dependabot gera assunto em
// sentence-case (`chore(deps-dev): Bump jscpd in the minor-and-patch group`), que
// a regra `subject-case` proíbe — e isso reprovava todo PR dele (medido em
// 11/09/2026). A primeira correção pôs um `ignores` aqui casando o TEXTO da
// mensagem, e ela tinha um buraco: qualquer pessoa que escrevesse
// `chore(deps): Bump ...` herdava a isenção.
//
// A isenção passou para o job `commit-messages` do CI, e lá ela é por AUTOR do
// commit. Consequência de forma: este arquivo volta a valer **para toda**
// mensagem que passe por ele — hook local incluído — e a exceção existe num
// lugar só, onde dá para saber quem assinou.
export default {
  extends: ['@commitlint/config-conventional'],
};
