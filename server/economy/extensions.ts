/**
 * Later modules can sit beside the scorer without changing it.
 * None of these are built in the current version.
 *
 * - news: sourced headlines for a phase (see phaseNews.ts)
 * - portfolio_exposure: map the signed-in user's holdings onto asset-class context
 * - scenario_simulator: call assessCycle with a supplied indicator set
 */
export type EconomyExtension = 'news' | 'portfolio_exposure' | 'scenario_simulator';
