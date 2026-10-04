import { Router } from 'express';
import { loadPhaseNews } from '../economy/phaseNews.ts';
import { EconomyCountryError, getEconomicCycle } from '../economy/service.ts';
import { PHASES, type Phase } from '../economy/types.ts';

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

router.get('/news', async (req, res) => {
  const raw = typeof req.query.phase === 'string' ? req.query.phase.trim() : '';
  let phase: Phase | null = null;
  if (raw) {
    if (!PHASES.includes(raw as Phase)) {
      res.status(400).json({ error: 'Unknown economic phase' });
      return;
    }
    phase = raw as Phase;
  }
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const country = typeof req.query.country === 'string' ? req.query.country : 'NZ';
  try {
    const payload = await loadPhaseNews(phase, { refresh }, country);
    res.json(payload);
  } catch (err) {
    if (err instanceof EconomyCountryError) {
      res.status(400).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'News feeds could not be loaded';
    res.status(502).json({ error: message });
  }
});

export default router;
