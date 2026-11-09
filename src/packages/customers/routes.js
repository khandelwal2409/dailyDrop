import express from 'express';
import { fail } from '../../shared/http.js';
import { publicUser } from '../../shared/users.js';
import { boundedText, emailPattern, parseProductInput, validDate, validMonth } from '../../shared/validation.js';

export function createCustomerRouter({ service, requireAuth }) {
  const router = express.Router();

  router.get('/me', requireAuth, async (req, res) => {
    res.json({ user: publicUser(await service.getProfile(req.user.id)) });
  });

  router.get('/vacations', requireAuth, async (req, res) => {
    res.json({ vacations: await service.listVacations(req.user.id) });
  });

  router.post('/vacations', requireAuth, async (req, res) => {
    const { startDate, endDate, note = '' } = req.body ?? {};
    if (!validDate(startDate) || !validDate(endDate) || endDate < startDate
        || !boundedText(note, 200, { optional: true })) return fail(res, 400, 'Please provide valid vacation dates and a note of at most 200 characters.');
    const result = await service.createVacation(req.user.id, { startDate, endDate, note });
    if (!result) return fail(res, 409, 'This vacation overlaps an existing vacation period.');
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  router.delete('/vacations/:vacationId', requireAuth, async (req, res) => {
    const vacationId = Number(req.params.vacationId);
    if (!Number.isSafeInteger(vacationId)) return fail(res, 400, 'Please provide a valid vacation.');
    if (!await service.deleteVacation(req.user.id, vacationId)) return fail(res, 404, 'Vacation period not found.');
    res.json({ ok: true });
  });

  router.put('/me', requireAuth, async (req, res) => {
    const { fullName, email, phone, address } = req.body ?? {};
    if (!boundedText(fullName, 100, { optional: true }) || !boundedText(email, 254, { optional: true })
        || !boundedText(phone, 40, { optional: true }) || !boundedText(address, 500, { optional: true })
        || (email && !emailPattern.test(email))) return fail(res, 400, 'Please check the profile details.');
    const user = await service.updateProfile(req.user.id, { fullName, email, phone, address });
    res.json({ user: publicUser(user) });
  });

  router.put('/me/password', requireAuth, async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body ?? {};
      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 10 || newPassword.length > 128) {
        return fail(res, 400, 'The new password must be between 10 and 128 characters.');
      }
      const changed = await service.changePassword(req.user.id, req.sessionHash, currentPassword, newPassword);
      if (!changed) return fail(res, 400, 'Current password is incorrect.');
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get('/products', requireAuth, async (req, res) => {
    res.json({ products: await service.listProducts(req.user.id) });
  });

  router.post('/products', requireAuth, async (req, res) => {
    const product = parseProductInput(req.body);
    if (!product) return fail(res, 400, 'Please check the product and schedule details.');
    const result = await service.createProduct(req.user.id, product);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  router.put('/products/:id', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const product = parseProductInput(req.body);
    if (!Number.isSafeInteger(id) || !product) return fail(res, 400, 'Please check the product and schedule details.');
    if (!await service.updateProduct(req.user.id, id, product)) return fail(res, 404, 'Product not found.');
    res.json({ ok: true });
  });

  router.delete('/products/:id', requireAuth, async (req, res) => {
    if (!await service.deleteProduct(req.user.id, Number(req.params.id))) return fail(res, 404, 'Product not found.');
    res.json({ ok: true });
  });

  router.get('/entries', requireAuth, async (req, res) => {
    const month = req.query.month;
    if (!validMonth(month)) return fail(res, 400, 'Month must use YYYY-MM format.');
    res.json({ entries: await service.listEntries(req.user.id, month) });
  });

  router.put('/entries/:date/:productId', requireAuth, async (req, res) => {
    const { date } = req.params;
    const productId = Number(req.params.productId);
    const quantity = req.body?.quantity;
    const hasUnitPrice = Object.hasOwn(req.body ?? {}, 'unitPrice');
    const unitPrice = req.body?.unitPrice;
    if (!validDate(date) || !Number.isSafeInteger(productId) || !Number.isInteger(quantity) || quantity < 0 || quantity > 100_000
        || (hasUnitPrice && (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000))) {
      return fail(res, 400, 'Please provide a valid date and quantity.');
    }
    const result = await service.saveEntry(req.user.id, date, productId, quantity, unitPrice, hasUnitPrice);
    if (result.error === 'product') return fail(res, 404, 'Product not found.');
    if (result.error === 'vacation') return fail(res, 409, 'Deliveries are paused during this customer vacation period.');
    res.json({ ok: true });
  });

  router.delete('/entries/:date/:productId', requireAuth, async (req, res) => {
    const productId = Number(req.params.productId);
    if (!validDate(req.params.date) || !Number.isSafeInteger(productId)) return fail(res, 400, 'Please provide a valid date and product.');
    await service.deleteEntry(req.user.id, productId, req.params.date);
    res.json({ ok: true });
  });

  router.get('/reports/monthly-totals', requireAuth, async (req, res) => {
    const to = req.query.to;
    const months = req.query.months === undefined ? 6 : Number(req.query.months);
    if (!validMonth(to) || !Number.isInteger(months) || months < 1 || months > 24) return fail(res, 400, 'Use a valid month and a month count from 1 to 24.');
    res.json({ totals: await service.getMonthlyTotals(req.user.id, to, months) });
  });

  router.get('/payments/:month', requireAuth, async (req, res) => {
    if (!validMonth(req.params.month)) return fail(res, 400, 'Month must use YYYY-MM format.');
    res.json(await service.getPaymentSummary(req.user.id, req.params.month));
  });

  return router;
}
