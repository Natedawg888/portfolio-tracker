/**
 * A fast country switch must ignore responses for a country that is no longer selected.
 * Run: npm run test:economy
 */
import {
  isCurrentCycleRequest,
  nextCycleLoad,
  shouldApplyCyclePayload,
  type CycleLoadTicket,
} from '../../src/pages/cycleLoad.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

type Page = { selected: string; dataCountry: string | null; loading: boolean };

function start(page: Page, current: number): { page: Page; current: number; ticket: CycleLoadTicket } {
  const ticket = nextCycleLoad(current, page.selected);
  return { page: { ...page, loading: true }, current: ticket.requestId, ticket };
}

function settle(page: Page, current: number, ticket: CycleLoadTicket, payloadCountry: string): Page {
  if (!isCurrentCycleRequest(ticket, current)) return page;
  if (!shouldApplyCyclePayload(ticket, current, payloadCountry)) return { ...page, loading: false };
  return { ...page, dataCountry: payloadCountry, loading: false };
}

let current = 0;
let page: Page = { selected: 'NZ', dataCountry: null, loading: true };
let nzFirst: CycleLoadTicket;
({ page, current, ticket: nzFirst } = start(page, current));
page = settle(page, current, nzFirst, 'NZ');
assert(page.dataCountry === 'NZ' && page.loading === false, 'the first New Zealand response is shown');

page = { ...page, selected: 'US' };
let us: CycleLoadTicket;
({ page, current, ticket: us } = start(page, current));
page = { ...page, selected: 'NZ' };
let nzAgain: CycleLoadTicket;
({ page, current, ticket: nzAgain } = start(page, current));

page = settle(page, current, us, 'US');
assert(page.dataCountry === 'NZ', 'a late United States response does not replace New Zealand');
assert(page.loading === true, 'a late United States response does not clear loading');

page = settle(page, current, nzFirst, 'NZ');
assert(page.loading === true, 'the original New Zealand response does not clear the later load');

page = settle(page, current, nzAgain, 'US');
assert(page.dataCountry === 'NZ' && page.loading === false, 'a mismatched country on the current request is not shown');

page = settle(page, current, nzAgain, 'NZ');
assert(page.dataCountry === 'NZ' && page.loading === false, 'the latest New Zealand response is shown');
assert(!shouldApplyCyclePayload(us, current, 'US'), 'the United States ticket stays stale after New Zealand returns');

console.log('cycle load tests passed');
