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

  it('não há ciclos de dependência', async () => {
    const rule = projectFiles().inFolder('src/**').should().haveNoCycles();
    await expect(rule).toPassAsync();
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
});
