const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export const usernamePattern = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validDate(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validMonth(value) {
  return typeof value === 'string' && monthPattern.test(value);
}

export function boundedText(value, max, { optional = false } = {}) {
  return typeof value === 'string' && (optional || value.trim().length > 0) && value.length <= max;
}

export function parseProductInput(body) {
  const { name, price, defaultQuantity, scheduleType, schedule = {} } = body ?? {};
  if (!boundedText(name, 80) || !Number.isFinite(price) || price < 0 || price > 1_000_000
      || !Number.isInteger(defaultQuantity) || defaultQuantity <= 0 || defaultQuantity > 100_000) return null;
  const types = new Set(['daily', 'alternate', 'every_n', 'weekdays', 'monthly', 'on_demand']);
  if (!types.has(scheduleType) || typeof schedule !== 'object' || Array.isArray(schedule)) return null;
  if (['alternate', 'every_n'].includes(scheduleType) && !validDate(schedule.startDate)) return null;
  if (scheduleType === 'every_n' && (!Number.isInteger(schedule.interval) || schedule.interval < 2 || schedule.interval > 365)) return null;
  if (scheduleType === 'weekdays' && (!Array.isArray(schedule.weekdays) || schedule.weekdays.length < 1 || schedule.weekdays.length > 7
      || schedule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
      || new Set(schedule.weekdays).size !== schedule.weekdays.length)) return null;
  if (scheduleType === 'monthly' && (!Number.isInteger(schedule.day) || schedule.day < 1 || schedule.day > 31)) return null;
  return { name: name.trim(), price, defaultQuantity, scheduleType, schedule };
}
