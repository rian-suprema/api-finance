import { readFileSync } from 'fs';
import path from 'path';

import {
  type CorrectionEntry,
  type CorrectionTarget,
  findCorrectionCandidates,
} from './correction-matcher';

const FIXTURE_PATH = path.join(process.cwd(), 'test', 'fixtures', 'reconciliation-maxima-2026-08-15.json');

interface CorrectionScenario {
  target: CorrectionTarget;
  entries: CorrectionEntry[];
}

interface Fixture {
  corrections: {
    exactSameBrand: CorrectionScenario;
    sum: CorrectionScenario;
    combinationCutoff: CorrectionScenario;
    partial: CorrectionScenario;
  };
}

const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));

describe('correction-matcher — busca de evidência de correção', () => {
  it('EXACT_SAME_BRAND: valor idêntico na mesma marca → primeiro candidato, exact = true', () => {
    const { target, entries } = fixture.corrections.exactSameBrand;
    const candidates = findCorrectionCandidates(target, entries);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].confidence).toBe('EXACT_SAME_BRAND');
    expect(candidates[0].differenceCents).toBe(0);
    const exact = candidates[0].differenceCents === 0 && candidates[0].confidence !== 'PARTIAL';
    expect(exact).toBe(true);
  });

  it('SUM: 2 correções cuja soma bate o valor exato → candidato SUM', () => {
    const { target, entries } = fixture.corrections.sum;
    const candidates = findCorrectionCandidates(target, entries);

    expect(candidates[0].confidence).toBe('SUM');
    expect(candidates[0].corrections).toHaveLength(2);
    expect(candidates[0].differenceCents).toBe(0);
  });

  it('corte de custo: mais de MAX_CORRECTIONS_FOR_COMBINATION (12) correções → não tenta somar', () => {
    const { target, entries } = fixture.corrections.combinationCutoff;
    expect(entries.length).toBeGreaterThan(12);

    const candidates = findCorrectionCandidates(target, entries);

    // 3 das 13 correções somam exatamente o valor-alvo (3 × 5000 = 15000), mas o
    // corte de custo bloqueia a tentativa antes de a combinação ser encontrada.
    expect(candidates.some((candidate) => candidate.confidence === 'SUM')).toBe(false);
  });

  it('PARTIAL: valor diferente, mesmo jogador → confiança PARTIAL, exact = false, ordenado pela menor diferença absoluta', () => {
    const { target, entries } = fixture.corrections.partial;
    const candidates = findCorrectionCandidates(target, entries);

    expect(candidates.every((candidate) => candidate.confidence === 'PARTIAL')).toBe(true);
    expect(candidates[0].corrections[0].correctionId).toBe('C-P1');
    expect(Math.abs(candidates[0].differenceCents)).toBeLessThan(
      Math.abs(candidates[1].differenceCents),
    );
    const exact = candidates[0].differenceCents === 0 && candidates[0].confidence !== 'PARTIAL';
    expect(exact).toBe(false);
  });
});
