import { Router } from 'express';
import { EconomyCountryError, getEconomicCycle } from '../economy/service.ts';

const router = Router();

router.get('/cycle', async (req, res) => {
  const country = typeof req.query.country === 'string' ? req.query.country : 'NZ';
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  try {
    const payload = await getEconomicCycle(country, { refresh });
    res.json(payload);
  } catch (err) {
    if (err instanceof EconomyCountryError) {
      res.status(400).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Could not calculate the economic cycle';
    res.status(500).json({ error: message });
  }
});

export default router;
