import { parseArgs, parseCsv } from './import-balance-history';

describe('import-balance-history CLI — parseArgs', () => {
  it('exige o caminho do CSV', () => {
    expect(() => parseArgs([])).toThrow(/informe o caminho do CSV/);
  });

  it('sem --apply, apply: false (só simula)', () => {
    const options = parseArgs(['dados.csv']);
    expect(options.apply).toBe(false);
    expect(options.overwrite).toBe(false);
  });

  it('--apply --overwrite propagam true', () => {
    const options = parseArgs(['dados.csv', '--apply', '--overwrite']);
    expect(options.apply).toBe(true);
    expect(options.overwrite).toBe(true);
  });
});

describe('import-balance-history CLI — parseCsv', () => {
  const HEADER =
    'reference_date,brand,celcoin,genial,zro,trio,caixa,saldo_bancos,saldo_jogadores,total_balanco';

  it('parseia uma linha válida', () => {
    const csv = `${HEADER}\n2026-07-01,suprema,100,0,0,800,0,900,400,500\n`;

    const rows = parseCsv(csv);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      referenceDate: '2026-07-01',
      brand: 'suprema',
      saldoTransacional: 900,
      saldoJogadores: 400,
      totalBalanco: 500,
    });
    expect(rows[0].bankBalances.get('trio')).toBe(800);
    expect(rows[0].bankBalances.get('celcoin')).toBe(100);
  });

  it('coluna obrigatória ausente → lança', () => {
    const csv = 'reference_date,brand\n2026-07-01,suprema\n';
    expect(() => parseCsv(csv)).toThrow(/coluna obrigatória ausente/);
  });

  it('marca fora do catálogo → lança (mesma defesa do assertKnownBrand)', () => {
    const csv = `${HEADER}\n2026-07-01,inexistente,100,0,0,800,0,900,400,500\n`;
    expect(() => parseCsv(csv)).toThrow(/marca desconhecida/);
  });

  it('data inválida → lança com o número da linha', () => {
    const csv = `${HEADER}\n29-07-2026,suprema,100,0,0,800,0,900,400,500\n`;
    expect(() => parseCsv(csv)).toThrow(/linha 2.*data inválida/);
  });

  it('só cabeçalho, sem linha de dado → lança', () => {
    expect(() => parseCsv(HEADER)).toThrow(/CSV sem linhas de dado/);
  });
});
