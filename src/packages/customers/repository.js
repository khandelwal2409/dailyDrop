import { monthEntries } from '../../shared/billing.js';

export function createCustomerRepository({ db, statements }) {
  return {
    findUserById(userId) {
      return statements.userById.get(userId);
    },
    listVacations(userId) {
      return db.prepare(`SELECT id, start_date AS "startDate", end_date AS "endDate", note
        FROM vacation_periods WHERE user_id = ? ORDER BY start_date`).all(userId);
    },
    hasOverlappingVacation(userId, startDate, endDate) {
      return db.prepare(`SELECT id FROM vacation_periods
        WHERE user_id = ? AND start_date <= ? AND end_date >= ? LIMIT 1`).get(userId, endDate, startDate);
    },
    createVacation(userId, startDate, endDate, note) {
      return db.prepare(`INSERT INTO vacation_periods (user_id, start_date, end_date, note, created_by)
        VALUES (?, ?, ?, ?, ?) RETURNING id`).run(userId, startDate, endDate, note, userId);
    },
    deleteVacation(userId, vacationId) {
      return db.prepare('DELETE FROM vacation_periods WHERE id = ? AND user_id = ?').run(vacationId, userId);
    },
    updateProfile(userId, { fullName, email, phone, address }) {
      return db.prepare('UPDATE users SET full_name = ?, email = ?, phone = ?, address = ? WHERE id = ?')
        .run(fullName, email, phone, address, userId);
    },
    getPasswordCredentials(userId) {
      return db.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').get(userId);
    },
    updatePassword(userId, hash, salt) {
      return db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, userId);
    },
    deleteOtherSessions(userId, currentSessionHash) {
      return db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, currentSessionHash);
    },
    listProducts(userId) {
      return statements.productsForUser.all(userId);
    },
    createProduct(userId, product) {
      return db.prepare('INSERT INTO products (user_id, name, price, default_quantity, schedule_type, schedule_config) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
        .run(userId, product.name, product.price, product.defaultQuantity, product.scheduleType, JSON.stringify(product.schedule));
    },
    updateProduct(userId, productId, product) {
      return db.prepare('UPDATE products SET name = ?, price = ?, default_quantity = ?, schedule_type = ?, schedule_config = ? WHERE id = ? AND user_id = ?')
        .run(product.name, product.price, product.defaultQuantity, product.scheduleType, JSON.stringify(product.schedule), productId, userId);
    },
    deleteProduct(userId, productId) {
      return db.prepare('DELETE FROM products WHERE id = ? AND user_id = ?').run(productId, userId);
    },
    findProductForUser(userId, productId) {
      return statements.productForUser.get(productId, userId);
    },
    isVacationDate(userId, date) {
      return db.prepare(`SELECT 1 FROM vacation_periods
        WHERE user_id = ? AND ? BETWEEN start_date AND end_date LIMIT 1`).get(userId, date);
    },
    findEntry(userId, productId, date) {
      return db.prepare('SELECT * FROM entries WHERE user_id = ? AND product_id = ? AND delivery_date = ?')
        .get(userId, productId, date);
    },
    saveEntry(userId, productId, date, quantity, productName, unitPrice) {
      return db.prepare(`INSERT INTO entries (user_id, product_id, delivery_date, quantity, product_name, unit_price)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, product_id, delivery_date) DO UPDATE SET
        quantity = excluded.quantity, product_name = CASE WHEN entries.product_name = '' THEN excluded.product_name ELSE entries.product_name END,
        unit_price = excluded.unit_price,
        updated_at = CURRENT_TIMESTAMP`)
        .run(userId, productId, date, quantity, productName, unitPrice);
    },
    deleteEntry(userId, productId, date) {
      return db.prepare('DELETE FROM entries WHERE user_id = ? AND product_id = ? AND delivery_date = ?')
        .run(userId, productId, date);
    },
    listEntriesForMonth(userId, month) {
      return monthEntries(statements, userId, month);
    },
    getPayment(userId, month) {
      return db.prepare('SELECT payment_month AS month, amount, method, note, updated_at AS "updatedAt" FROM payments WHERE user_id = ? AND payment_month = ?')
        .get(userId, month);
    },
  };
}
