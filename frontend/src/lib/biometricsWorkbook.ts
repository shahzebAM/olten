import type { CellObject, WorkBook } from 'xlsx';
import { biometricDate, MAX_BIOMETRIC_PUNCHES } from '../../../backend/src/employees/biometrics-import';
import type { RawBiometricPunch } from '../../../backend/src/employees/biometrics-import';

export const MAX_BIOMETRIC_FILE_BYTES = 5 * 1024 * 1024;
const fields = ['personnelId', 'date', 'time', 'direction'] as const;
const headers: Record<typeof fields[number], string[]> = {
  personnelId: ['personnelid', 'employeeid', 'personnelno', 'employeeno'],
  date: ['date', 'punchdate'], time: ['time', 'punchtime'], direction: ['inout', 'direction', 'status'],
};
const headerKey = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export type BiometricWorkbookResult = { rows: RawBiometricPunch[]; startDate: string; endDate: string; sheetCount: number };

export async function readBiometricsFile(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<BiometricWorkbookResult> {
  if (!/\.(xls|xlsx|csv)$/i.test(file.name)) throw new Error('Choose a biometrics .xls, .xlsx or .csv file.');
  if (!file.size || file.size > MAX_BIOMETRIC_FILE_BYTES) throw new Error('Choose a nonempty file no larger than 5 MB.');
  const loaded = await import('xlsx');
  const xlsx = loaded.default ?? loaded;
  // The supplied .xls export actually contains an XLSX workbook. Detect by
  // content through SheetJS, rather than assuming the extension is the format.
  const workbook = xlsx.read(await file.arrayBuffer(), { type: 'array', raw: true, cellDates: false, cellText: true });
  return extractBiometricRows(workbook);
}

export async function extractBiometricRows(workbook: WorkBook): Promise<BiometricWorkbookResult> {
  const loaded = await import('xlsx');
  const xlsx = loaded.default ?? loaded;
  const rows: RawBiometricPunch[] = [];
  let sheetCount = 0;
  const date1904 = workbook.Workbook?.WBProps?.date1904 === true;
  const cellValue = (cell: CellObject | undefined, field: typeof fields[number]): string => {
    if (!cell || cell.v === undefined || cell.v === null) return '';
    if (cell.f) throw new Error('Punch columns must contain exported values, not formulas.');
    if (field === 'personnelId') {
      if (typeof cell.v === 'number' && !Number.isSafeInteger(cell.v)) throw new Error('A numeric personnel ID exceeds safe precision. Export that ID as text.');
      return String(cell.w ?? cell.v).trim();
    }
    if (typeof cell.v === 'number' && field === 'date') {
      const value = xlsx.SSF.parse_date_code(cell.v, { date1904 });
      return value ? `${String(value.y).padStart(4, '0')}-${String(value.m).padStart(2, '0')}-${String(value.d).padStart(2, '0')}` : String(cell.v);
    }
    if (typeof cell.v === 'number' && field === 'time' && cell.v >= 0) {
      const seconds = Math.floor((cell.v % 1) * 86400 + 0.000001);
      return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return String(cell.v).trim();
  };
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet?.['!ref']) continue;
    const range = xlsx.utils.decode_range(sheet['!ref']);
    if (range.e.r - range.s.r > MAX_BIOMETRIC_PUNCHES + 50 || range.e.c > 1000) throw new Error('The sheet is too large. Export at most 10,000 punch rows.');
    let indices: Record<typeof fields[number], number> | undefined;
    let headerRow = -1;
    for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 49); row++) {
      const found = Object.fromEntries(fields.map(field => [field, [] as number[]])) as Record<typeof fields[number], number[]>;
      for (let col = range.s.c; col <= range.e.c; col++) {
        const key = headerKey(sheet[xlsx.utils.encode_cell({ r: row, c: col })]?.v);
        for (const field of fields) if (headers[field].includes(key)) found[field].push(col);
      }
      if (fields.every(field => found[field].length)) {
        if (fields.some(field => found[field].length !== 1)) throw new Error('A required punch column is repeated. Keep one ID, date, time and IN/OUT column.');
        indices = Object.fromEntries(fields.map(field => [field, found[field][0]])) as typeof indices;
        headerRow = row; break;
      }
    }
    if (!indices) continue;
    sheetCount++;
    for (let row = headerRow + 1; row <= range.e.r; row++) {
      const values = Object.fromEntries(fields.map(field => [field, cellValue(sheet[xlsx.utils.encode_cell({ r: row, c: indices[field] })], field)])) as Record<typeof fields[number], string>;
      if (fields.every(field => !values[field])) continue;
      if (fields.every(field => headers[field].includes(headerKey(values[field])))) continue;
      rows.push({ ...values, rowNumber: row + 1 });
      if (rows.length > MAX_BIOMETRIC_PUNCHES) throw new Error('Export at most 10,000 punch rows per file.');
    }
  }
  if (!sheetCount) throw new Error('Required columns: PERSONNEL ID, DATE, TIME and IN / OUT.');
  if (!rows.length) throw new Error('The workbook contains no punch rows.');
  const dates = rows.map(row => biometricDate(row.date)).filter((date): date is string => date !== null).sort();
  if (!dates.length) throw new Error('No valid dates found. Use YYYY-MM-DD or MM-DD-YYYY dates.');
  return { rows, startDate: dates[0], endDate: dates[dates.length - 1], sheetCount };
}
