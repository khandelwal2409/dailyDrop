import { entriesTotal, paymentStatus } from '../../shared/billing.js';
import { hashPassword, verifyPassword } from '../../shared/passwords.js';

export function createCustomerService(repository) {
  return {
    getProfile(userId) {
      return repository.findUserById(userId);
    },
    listVacations(userId) {
      return repository.listVacations(userId);
    },
    async createVacation(userId, { startDate, endDate, note }) {
      if (await repository.hasOverlappingVacation(userId, startDate, endDate)) return null;
      return repository.createVacation(userId, startDate, endDate, note.trim());
    },
    async deleteVacation(userId, vacationId) {
      const result = await repository.deleteVacation(userId, vacationId);
      return result.changes > 0;
    },
    async updateProfile(userId, profile) {
      await repository.updateProfile(userId, {
        fullName: profile.fullName.trim(),
        email: profile.email.trim(),
        phone: profile.phone.trim(),
        address: profile.address.trim(),
      });
      return repository.findUserById(userId);
    },
    async changePassword(userId, currentSessionHash, currentPassword, newPassword) {
      const user = await repository.getPasswordCredentials(userId);
      if (!await verifyPassword(currentPassword, user)) return false;
      const { salt, hash } = await hashPassword(newPassword);
      await repository.updatePassword(userId, hash, salt);
      await repository.deleteOtherSessions(userId, currentSessionHash);
      return true;
    },
    async listProducts(userId) {
      return (await repository.listProducts(userId)).map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        defaultQuantity: product.default_quantity,
        scheduleType: product.schedule_type,
        schedule: JSON.parse(product.schedule_config),
      }));
    },
    createProduct(userId, product) {
      return repository.createProduct(userId, product);
    },
    async updateProduct(userId, productId, product) {
      const result = await repository.updateProduct(userId, productId, product);
      return result.changes > 0;
    },
    async deleteProduct(userId, productId) {
      const result = await repository.deleteProduct(userId, productId);
      return result.changes > 0;
    },
    async saveEntry(userId, date, productId, quantity, requestedUnitPrice, hasUnitPrice) {
      const product = await repository.findProductForUser(userId, productId);
      if (!product) return { error: 'product' };
      if (await repository.isVacationDate(userId, date)) return { error: 'vacation' };
      const previous = await repository.findEntry(userId, productId, date);
      const unitPrice = hasUnitPrice ? requestedUnitPrice : previous?.unit_price ?? product.price;
      await repository.saveEntry(userId, productId, date, quantity, previous?.product_name || product.name, unitPrice);
      return { ok: true };
    },
    deleteEntry(userId, productId, date) {
      return repository.deleteEntry(userId, productId, date);
    },
    listEntries(userId, month) {
      return repository.listEntriesForMonth(userId, month);
    },
    async getMonthlyTotals(userId, month, monthCount) {
      const [year, monthNumber] = month.split('-').map(Number);
      const totals = [];
      for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
        const date = new Date(Date.UTC(year, monthNumber - 1 - offset, 1));
        const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
        const entries = await repository.listEntriesForMonth(userId, key);
        totals.push({
          month: key,
          total: entriesTotal(entries),
          deliveries: entries.filter((entry) => entry.quantity > 0).length,
          missed: entries.filter((entry) => entry.quantity === 0).length,
        });
      }
      return totals;
    },
    async getPaymentSummary(userId, month) {
      const payment = await repository.getPayment(userId, month) ?? null;
      const bill = entriesTotal(await repository.listEntriesForMonth(userId, month));
      return { payment, bill, status: paymentStatus(bill, payment?.amount ?? 0) };
    },
  };
}
