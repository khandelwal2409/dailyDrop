export function money(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function entriesTotal(rows) {
  return money(rows.reduce((sum, row) => sum + (row.quantity > 0 ? row.quantity * row.unit_price : 0), 0));
}

export function monthBounds(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = `${month}-01`;
  const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  return [start, next];
}

export async function monthEntries(statements, userId, month) {
  const [start, next] = monthBounds(month);
  return statements.entriesForMonth.all(userId, start, next);
}

export function paymentStatus(bill, paid) {
  if (bill === 0) return 'no-bill';
  if (paid <= 0) return 'pending';
  if (paid + 0.005 >= bill) return 'paid';
  return 'partial';
}
