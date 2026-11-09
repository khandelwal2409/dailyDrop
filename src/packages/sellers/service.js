import { money, paymentStatus } from '../../shared/billing.js';

export function createSellerService(repository, sellerUsernames) {
  return {
    async getOverview() {
      const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
      const counts = await repository.getOverviewCounts(monthStart);
      const sellers = sellerUsernames === null ? null : [...sellerUsernames];
      return {
        users: Number(counts.users),
        products: Number(counts.products),
        monthEntries: Number(counts.monthentries),
        sellers,
      };
    },
    async getBills(month) {
      const [users, subscriptions, entries, payments] = await Promise.all([
        repository.listUsers(),
        repository.listProducts(),
        repository.listEntriesForMonth(month),
        repository.listPaymentsForMonth(month),
      ]);
      const paymentByUser = new Map(payments.map((payment) => [payment.user_id, payment]));
      const subscriptionsByUser = new Map();
      for (const product of subscriptions) {
        const userProducts = subscriptionsByUser.get(product.user_id) ?? [];
        userProducts.push({
          name: product.name,
          defaultQuantity: product.default_quantity,
          scheduleType: product.schedule_type,
          schedule: JSON.parse(product.schedule_config),
        });
        subscriptionsByUser.set(product.user_id, userProducts);
      }
      const entriesByUser = new Map();
      for (const entry of entries) {
        const userEntries = entriesByUser.get(entry.user_id) ?? [];
        userEntries.push(entry);
        entriesByUser.set(entry.user_id, userEntries);
      }
      const rows = users.map((user) => {
        const groups = new Map();
        for (const entry of entriesByUser.get(user.id) ?? []) {
          const key = `${entry.product_id}:${entry.product_name}`;
          const group = groups.get(key) ?? { product: entry.product_name, quantity: 0, amount: 0 };
          group.quantity += entry.quantity;
          if (entry.quantity > 0) group.amount += entry.quantity * entry.unit_price;
          groups.set(key, group);
        }
        const products = [...groups.values()].map((group) => ({ ...group, amount: money(group.amount) }));
        const bill = money(products.reduce((sum, product) => sum + product.amount, 0));
        const payment = paymentByUser.get(user.id) ?? null;
        const paid = payment?.amount ?? 0;
        return {
          userId: user.id,
          username: user.username,
          fullName: user.full_name,
          subscriptions: subscriptionsByUser.get(user.id) ?? [],
          products,
          bill,
          payment,
          paid,
          outstanding: money(Math.max(0, bill - paid)),
          status: paymentStatus(bill, paid),
        };
      });
      return {
        month,
        rows,
        totals: {
          billed: money(rows.reduce((sum, row) => sum + row.bill, 0)),
          collected: money(rows.reduce((sum, row) => sum + row.paid, 0)),
          outstanding: money(rows.reduce((sum, row) => sum + row.outstanding, 0)),
        },
      };
    },
    async savePayment(userId, month, amount, method, note, updatedBy) {
      if (!await repository.findUserById(userId)) return false;
      await repository.savePayment(userId, month, amount, method, note.trim(), updatedBy);
      return true;
    },
    deletePayment(userId, month) {
      return repository.deletePayment(userId, month);
    },
  };
}
