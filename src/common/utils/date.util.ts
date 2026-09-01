/**
 * Este módulo trabalha inteiro em BRT (America/Sao_Paulo): tanto `dia_brt` do
 * `fct_kpi_daily` quanto `summary_date` do `fct_sigap_saldo_diario` são
 * tratados como BRT. Datas trafegam sempre como `YYYY-MM-DD`.
 */
export const TIME_ZONE = 'America/Sao_Paulo';

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const brtFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data corrente em BRT no formato `YYYY-MM-DD`. */
export function todayInBrt(now: Date = new Date()): string {
  return brtFormatter.format(now);
}

/** Dia anterior em BRT — referência padrão do balanço. */
export function yesterdayInBrt(now: Date = new Date()): string {
  const previous = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return brtFormatter.format(previous);
}

export function isIsoDate(value: string): boolean {
  return ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Primeiro dia do mês da data informada. */
export function startOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/** Primeiro dia do mês seguinte ao da data informada — limite superior exclusivo. */
export function startOfNextMonth(isoDate: string): string {
  const [year, month] = isoDate.slice(0, 7).split('-').map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** Converte `YYYY-MM-DD` para Date (meia-noite UTC), formato esperado por `@db.Date`. */
export function toDateOnly(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Converte um valor `@db.Date` de volta para `YYYY-MM-DD`. */
export function fromDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const OFFSET_PATTERN = /GMT([+-])(\d{2}):(\d{2})/;

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  timeZoneName: 'longOffset',
});

/**
 * Offset de BRT em minutos na data informada (por exemplo -180 para UTC-3).
 *
 * O Brasil não tem horário de verão desde 2019, mas o offset é consultado em
 * vez de fixado em -3: se o DST voltar, o corte do dia continua correto.
 */
function brtOffsetMinutes(at: Date): number {
  const parts = offsetFormatter.formatToParts(at);
  const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  const match = OFFSET_PATTERN.exec(raw);

  if (!match) return -180;

  const [, sign, hours, minutes] = match;
  const total = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -total : total;
}

/**
 * Instante UTC da meia-noite BRT da data informada.
 *
 * É o corte do fechamento: o saldo em `brtMidnightUtc('2026-07-30')` é o
 * fechamento de 29/07 às 23:59:59. Convenção confirmada contra o extrato
 * oficial da Trio, que fecha o dia no mesmo instante.
 */
export function brtMidnightUtc(isoDate: string): Date {
  const localMidnight = new Date(`${isoDate}T00:00:00.000Z`);
  return new Date(localMidnight.getTime() - brtOffsetMinutes(localMidnight) * 60_000);
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** Data deslocada em dias (negativo volta no tempo), em `YYYY-MM-DD`. */
export function shiftDays(isoDate: string, days: number): string {
  const shifted = new Date(`${isoDate}T00:00:00.000Z`).getTime() + days * DAY_IN_MS;
  return new Date(shifted).toISOString().slice(0, 10);
}

/** Dia seguinte a `isoDate`, em `YYYY-MM-DD`. */
export function nextDay(isoDate: string): string {
  return shiftDays(isoDate, 1);
}

/** Dias corridos do intervalo, com os dois extremos incluídos. */
export function daysInRange(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.floor((end - start) / DAY_IN_MS) + 1;
}
