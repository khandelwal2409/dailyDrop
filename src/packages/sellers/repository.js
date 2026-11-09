import { monthBounds } from '../../shared/billing.js';

export function createSellerRepository({ db, statements }) {
  return {
    getOverviewCounts(monthStart) {
      return db.prepare(`SELECT COUNT(*) AS users,
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM entries WHERE delivery_date >= ?) AS monthEntries
        FROM users`).get(monthStart);
    },
    listUsers() {
      return db.prepare('SELECT id, username, full_name FROM users ORDER BY lower(username)').all();
    },
    listProducts() {
      return db.prepare(`SELECT user_id, name, default_quantity, schedule_type, schedule_config
        FROM products ORDER BY user_id, lower(name)`).all();
    },
    listEntriesForMonth(month) {
      const [start, next] = monthBounds(month);
      return db.prepare(`SELECT user_id, product_id, product_name, unit_price, quantity, delivery_date
        FROM entries WHERE delivery_date >= ? AND delivery_date < ?
          AND NOT EXISTS (SELECT 1 FROM vacation_periods
            WHERE vacation_periods.user_id = entries.user_id
              AND entries.delivery_date BETWEEN vacation_periods.start_date AND vacation_periods.end_date)
        ORDER BY user_id, product_name, delivery_date`).all(start, next);
    },
    listPaymentsForMonth(month) {
      return db.prepare('SELECT user_id, amount, method, note, updated_at AS "updatedAt" FROM payments WHERE payment_month = ?').all(month);
    },
    findUserById(userId) {
      return statements.userById.get(userId);
    },
    savePayment(userId, month, amount, method, note, updatedBy) {
      return db.prepare(`INSERT INTO payments (user_id, payment_month, amount, method, note, updated_by)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id,payment_month) DO UPDATE SET
        amount = excluded.amount, method = excluded.method, note = excluded.note, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
        .run(userId, month, amount, method, note, updatedBy);
    },
    deletePayment(userId, month) {
      return db.prepare('DELETE FROM payments WHERE user_id = ? AND payment_month = ?').run(userId, month);
    },
  };
}
