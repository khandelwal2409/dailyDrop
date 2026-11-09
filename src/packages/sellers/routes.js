import express from 'express';
import { fail } from '../../shared/http.js';
import { boundedText, validMonth } from '../../shared/validation.js';

const paymentMethods = new Set(['Cash', 'UPI', 'Card', 'Bank transfer', 'Other']);

export function createSellerRouter({ service, requireAuth, requireSeller }) {
  const router = express.Router();

  router.get('/seller/overview', requireAuth, requireSeller, async (req, res) => {
    res.json(await service.getOverview());
  });

  router.get('/seller/bills', requireAuth, requireSeller, async (req, res) => {
    const month = req.query.month;
    if (!validMonth(month)) return fail(res, 400, 'Month must use YYYY-MM format.');
    res.json(await service.getBills(month));
  });

  router.put('/seller/payments/:userId/:month', requireAuth, requireSeller, async (req, res) => {
    const userId = Number(req.params.userId);
    const { amount, method, note = '' } = req.body ?? {};
    if (!Number.isSafeInteger(userId) || !validMonth(req.params.month) || !Number.isFinite(amount) || amount <= 0 || amount > 100_000_000
        || !paymentMethods.has(method) || !boundedText(note, 300, { optional: true })) return fail(res, 400, 'Please check the payment details.');
    const saved = await service.savePayment(userId, req.params.month, amount, method, note, req.user.id);
    if (!saved) return fail(res, 404, 'User not found.');
    res.json({ ok: true });
  });

  router.delete('/seller/payments/:userId/:month', requireAuth, requireSeller, async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isSafeInteger(userId) || !validMonth(req.params.month)) return fail(res, 400, 'Please provide a valid user and month.');
    await service.deletePayment(userId, req.params.month);
    res.json({ ok: true });
  });

  return router;
}
