import { projectFiles } from 'archunit';

/**
 * Testes de ARQUITETURA (ArchUnitTS) — as regras do README §5 deixam de ser
 * prosa e viram gate: rodam no `npm test`, dentro do quality-validation.
 * Nenhuma regra aqui é aspiracional: todas nascem verdes contra esta base —
 * o teste existe para o PRÓXIMO import errado (humano ou gerado por IA).
 */

/** Regras de CONTEÚDO valem para código de produção — spec é teste, não código.
 *  (Sem isso, este próprio arquivo violaria as regras que declara.) */
const isSpecFile = (path: string): boolean => path.endsWith('.spec.ts');

/**
 * Pilares de segurança em tempo de BUILD: conta handlers HTTP cujo bloco de
 * decorators não declara @Permissions(...) nem @Public() — aceitando também a
 * declaração no NÍVEL DA CLASSE (bloco do @Controller), como faz o
 * HealthController. Heurística de conteúdo: agrupa decorators consecutivos
 * (args multilinha via balanço de parênteses) — o bloco fecha na assinatura
 * do método/classe. Validada plantando violação real (teste do testador);
 * a autoridade em runtime é o PermissionsGuard (deny-by-default) — esta
 * regra só antecipa o erro.
 */
const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(/;
const SECURITY_DECORATOR = /@(Permissions|Public)\s*\(/;
const parenBalance = (line: string): number =>
  (line.match(/\(/g)?.length ?? 0) - (line.match(/\)/g)?.length ?? 0);

const routesWithoutSecurityDeclaration = (content: string): number => {
  let missing = 0;
  let classCovered = false;
  let block: string[] = [];
  let openParens = 0;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (openParens > 0 || line.startsWith('@')) {
      // dentro do bloco de decorators (ou continuação de args multilinha)
      block.push(line);
      openParens = Math.max(0, openParens + parenBalance(line));
      continue;
    }
    if (line === '') continue;
    // linha de código comum (assinatura do método/classe) fecha o bloco
    const decorators = block.join('\n');
    if (/@Controller\s*\(/.test(decorators)) {
      classCovered = SECURITY_DECORATOR.test(decorators);
    } else if (
      ROUTE_DECORATOR.test(decorators) &&
      !SECURITY_DECORATOR.test(decorators) &&
      !classCovered
    ) {
      missing += 1;
    }
    block = [];
  }
  return missing;
};

describe('Arquitetura do archetype (variante simples)', () => {
  // Fronteira exemplo×esqueleto: apagar o módulo [EXEMPLO] nunca pode
  // quebrar o esqueleto — logo o esqueleto não pode depender dele.
  // (app.module fica de fora: ele é o composition root, monta os módulos.)
  describe('esqueleto não depende de [EXEMPLO]', () => {
    it.each(['common', 'config', 'database', 'health'])(
      'src/%s não importa de modules/',
      async (folder) => {
        const rule = projectFiles()
          .inFolder(`src/${folder}/**`)
          .shouldNot()
          .dependOnFiles()
          .inFolder('src/modules/**');
        await expect(rule).toPassAsync();
      },
    );
  });

  // ADR-FINANCE-3: `haveNoCycles()` do ArchUnitTS não distingue import de TIPO
  // de import de VALOR — um ciclo de arquivo aparece mesmo quando um dos dois
  // lados usa `import type` (que não gera dependência em tempo de execução).
  // O TypeORM exige relação bidirecional real (@OneToMany + @ManyToOne) entre
  // CashBalanceDay↔CashBalanceDaily e ReconciliationRun↔ReconciliationItem
  // (DADOS-FINANCE.md §3.1/§3.2 e §4.1/§4.2) — cada par referencia a classe do
  // outro por construção. As duas pastas de entities/ do Finance saem do
  // escopo desta regra geral; a regra seguinte garante, dentro delas, que o
  // lado "pai" nunca importa a classe "filha" como valor (só como tipo) — ou
  // seja, que o ciclo real (de valor) continua inexistente.
  it('não há ciclos de dependência', async () => {
    const rule = projectFiles()
      .inFolder('src/**', {
        except: {
          inFolder: [
            'src/modules/finance-cash-balance/entities/**',
            'src/modules/finance-reconciliation/entities/**',
          ],
        },
      })
      .should()
      .haveNoCycles();
    await expect(rule).toPassAsync();
  });

  it('CashBalanceDay só importa CashBalanceDaily como tipo (evita reintroduzir o ciclo real)', async () => {
    const violations = await projectFiles()
      .inFolder('src/modules/finance-cash-balance/entities/**')
      .inFile('src/modules/finance-cash-balance/entities/cash-balance-day.entity.ts')
      .should()
      .adhereTo(
        (file) => /import type \{[^}]*\bCashBalanceDaily\b/.test(file.content),
        "cash-balance-day.entity.ts deve importar CashBalanceDaily só como 'import type'",
      )
      .check();
    expect(violations).toStrictEqual([]);
  });

  it('ReconciliationRun só importa ReconciliationItem como tipo (evita reintroduzir o ciclo real)', async () => {
    const violations = await projectFiles()
      .inFolder('src/modules/finance-reconciliation/entities/**')
      .inFile('src/modules/finance-reconciliation/entities/reconciliation-run.entity.ts')
      .should()
      .adhereTo(
        (file) => /import type \{[^}]*\bReconciliationItem\b/.test(file.content),
        "reconciliation-run.entity.ts deve importar ReconciliationItem só como 'import type'",
      )
      .check();
    expect(violations).toStrictEqual([]);
  });

  // Organização NestJS: entity em entities/, DTO em dto/ — pelo nome certo.
  describe('convenções de organização (padrão NestJS)', () => {
    it('entities/ só contém *.entity.ts', async () => {
      const rule = projectFiles().inFolder('src/**/entities/**').should().haveName('*.entity.ts');
      await expect(rule).toPassAsync();
    });

    it('dto/ só contém *.dto.ts', async () => {
      const rule = projectFiles().inFolder('src/**/dto/**').should().haveName('*.dto.ts');
      await expect(rule).toPassAsync();
    });
  });

  // Camadas NestJS: controller fino → service → repositório. Controller que
  // importa typeorm está pulando a camada de serviço.
  it('controllers não importam typeorm (controller fino)', async () => {
    const violations = await projectFiles()
      .withName('*.controller.ts')
      .should()
      .adhereTo(
        (file) => !/from '(typeorm|@nestjs\/typeorm)'/.test(file.content),
        'controller não acessa a camada de persistência diretamente',
      )
      .check();
    expect(violations).toStrictEqual([]);
  });

  it('services não dependem de controllers (direção das camadas)', async () => {
    const rule = projectFiles()
      .withName('*.service.ts')
      .shouldNot()
      .dependOnFiles()
      .withName('*.controller.ts');
    await expect(rule).toPassAsync();
  });

  // README §5 regra 6: validação de env é centralizada — joi só em config/.
  it("só config/ importa 'joi'", async () => {
    const violations = await projectFiles()
      .inFolder('src/**')
      .should()
      .adhereTo(
        (file) =>
          isSpecFile(file.path) ||
          file.directory.includes('config') ||
          !/from 'joi'/.test(file.content),
        'validação de ambiente vive em src/config',
      )
      .check();
    expect(violations).toStrictEqual([]);
  });

  // Deny-by-default do PermissionsGuard antecipado para o BUILD: rota nova
  // sem declaração de segurança não passa no `npm test` local nem no CI —
  // o dev descobre em segundos, não em produção via 403.
  it('pilares de segurança: toda rota declara @Permissions(...) ou @Public()', async () => {
    const violations = await projectFiles()
      .withName('*.controller.ts')
      .should()
      .adhereTo(
        (file) => isSpecFile(file.path) || routesWithoutSecurityDeclaration(file.content) === 0,
        'handler HTTP sem @Permissions/@Public — rota nasceria negada (deny-by-default)',
      )
      .check();
    expect(violations).toStrictEqual([]);
  });

  // A ADR da variante simples ("capacidade só entra quando o domínio precisa")
  // como gate: cache, mensageria e HTTP externo NÃO entram de contrabando.
  // Se o domínio passar a precisar, é decisão consciente — remove-se esta
  // regra e importam-se os padrões da variante completa (petstore-api).
  it('sem contrabando de capacidades: cache, mensageria e HTTP externo não existem nesta variante', async () => {
    const banned =
      /from '(@aws-sdk\/[^']*|@ssut\/nestjs-sqs|@nestjs\/(cache-manager|axios)|cache-manager|@keyv\/[^']*)'/;
    const violations = await projectFiles()
      .inFolder('src/**')
      .should()
      .adhereTo(
        (file) => isSpecFile(file.path) || !banned.test(file.content),
        'variante simples não usa cache/mensageria/HTTP externo — adote a variante completa se precisar',
      )
      .check();
    expect(violations).toStrictEqual([]);
  });

  // ADR-FINANCE-1: HTTP externo (axios) só dentro dos adapters nomeados — Trio
  // (integração bancária) e platform (GET /auth/me da SayPlus, Fase 08). Duas
  // pastas, não "infrastructure/** de qualquer módulo": a intenção é nomear
  // cada capacidade que entra, não abrir um allowlist genérico.
  it('axios cru só existe nos adapters da Trio e da identidade da plataforma', async () => {
    const violations = await projectFiles()
      .inFolder('src/**')
      .should()
      .adhereTo(
        (file) =>
          isSpecFile(file.path) ||
          file.directory.includes('infrastructure/trio') ||
          file.directory.includes('infrastructure/platform') ||
          !/from 'axios'/.test(file.content),
        'axios só é permitido em modules/finance-*/infrastructure/{trio,platform}/** — ' +
          'HTTP externo em outro lugar é decisão que precisa de ADR próprio',
      )
      .check();
    expect(violations).toStrictEqual([]);
  });

  // ADR-FINANCE-2: ClickHouse é read-model, confinado à pasta que existe pra isso.
  it('@clickhouse/client só existe em src/clickhouse/ e nos adapters de leitura', async () => {
    const violations = await projectFiles()
      .inFolder('src/**')
      .should()
      .adhereTo(
        (file) =>
          isSpecFile(file.path) ||
          file.directory.includes('src/clickhouse') ||
          file.directory.includes('infrastructure/clickhouse') ||
          !/from '@clickhouse\/client'/.test(file.content),
        '@clickhouse/client só é permitido em src/clickhouse/** e em ' +
          'infrastructure/clickhouse/** de cada módulo',
      )
      .check();
    expect(violations).toStrictEqual([]);
  });
});
