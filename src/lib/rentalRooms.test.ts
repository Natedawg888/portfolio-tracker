/**
 * Rooms: expected rent, occupancy, vacancy days, shared-cost split and the boarder tax figures (KAN-83).
 * Run: npm run test:rentals
 */
import {
  IRD_BOARDER_WEEKLY_STANDARD_COST,
  boarderTaxInfo,
  dailyRent,
  daysInclusive,
  propertyOccupancy,
  tenanciesOverlap,
  type RentFrequency,
} from './rentalRooms.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(dailyRent(70, 'weekly') === 10 && dailyRent(140, 'fortnightly') === 10, 'weekly and fortnightly per day');
assert(Math.abs(dailyRent(365, 'monthly') - 12) < 1e-9, 'monthly is × 12 ÷ 365');
assert(daysInclusive('2026-04-01', '2026-04-01') === 1 && daysInclusive('2026-04-02', '2026-04-01') === 0, 'inclusive days');

const span = (startDate: string, endDate: string | null) => ({ startDate, endDate });
assert(tenanciesOverlap(span('2026-04-01', '2026-04-30'), span('2026-04-30', null)), 'sharing an end day overlaps');
assert(!tenanciesOverlap(span('2026-04-01', '2026-04-30'), span('2026-05-01', null)), 'back to back does not');
assert(tenanciesOverlap(span('2026-04-01', null), span('2030-01-01', '2030-02-01')), 'open-ended runs on');
assert(!tenanciesOverlap(span('2026-06-01', '2026-06-30'), span('2026-04-01', '2026-05-31')), 'earlier one does not');

// Home with three rooms, two let; tax year 2026–27 up to 17 Oct 2026 (200 days).
const room = (id: string, share: number, created: string, propertyId = 'home') => ({ id, propertyId, name: id, share, createdAt: `${created}T09:00:00.000Z` });
const rooms = [room('r1', 1, '2026-04-01'), room('r2', 1, '2026-04-01'), room('r3', 2, '2026-09-01'), room('other', 1, '2026-04-01', 'flat')];
let n = 0;
const ten = (roomId: string, rentAmount: number, rentFrequency: RentFrequency, startDate: string, endDate: string | null = null) => ({
  id: `t${++n}`,
  roomId,
  tenantLabel: `Tenant ${n}`,
  rentAmount,
  rentFrequency,
  startDate,
  endDate,
});
const tenancies = [
  ten('r1', 250, 'weekly', '2026-04-01'),
  ten('r2', 1000, 'monthly', '2026-04-01', '2026-04-30'),
  ten('r2', 560, 'fortnightly', '2026-07-01'),
  ten('other', 400, 'weekly', '2026-04-01'),
];
const entry = (date: string, kind: 'income' | 'expense', amountNzd: number, extra: { roomId?: string; shared?: boolean; propertyId?: string } = {}) => ({
  propertyId: extra.propertyId ?? 'home',
  roomId: extra.roomId ?? null,
  date,
  kind,
  amountNzd,
  shared: extra.shared ?? false,
});
const entries = [
  entry('2026-10-10', 'income', 250, { roomId: 'r1' }),
  entry('2026-10-10', 'income', 280, { roomId: 'r2' }),
  entry('2026-10-11', 'income', 99), // property income with no room: not room rent
  entry('2026-10-01', 'expense', 400, { shared: true }),
  entry('2026-09-01', 'expense', 1000),
  entry('2026-03-01', 'expense', 300, { shared: true }), // last tax year
  entry('2026-10-01', 'expense', 500, { shared: true, propertyId: 'flat' }),
];

const occ = propertyOccupancy('home', rooms, tenancies, entries, 2027, '2026-10-17');
assert(occ.period?.start === '2026-04-01' && occ.period.end === '2026-10-17', 'period ends today');
assert(occ.rooms.length === 3 && occ.occupied === 2 && occ.vacant === 1, 'three rooms, two let, one vacant');
const [r1, r2, r3] = occ.rooms;
assert(r1.current?.tenantLabel === 'Tenant 1' && r2.current?.tenantLabel === 'Tenant 3' && r3.current === null, 'current tenants');
assert(r1.expected === 7142.86 && r1.vacancyDays === 0, 'r1: 200 days at $250 a week');
assert(r2.expected === 5346.3, `r2: 30 days monthly + 109 days fortnightly (${r2.expected})`);
assert(r2.vacancyDays === 61, 'r2: May and June vacant');
assert(r3.expected === 0 && r3.vacancyDays === 47, 'r3: vacant since it was added on 1 Sep');
assert(r1.received === 250 && r2.received === 280 && r3.received === 0, 'received per room');
assert(occ.expected === 12489.16 && occ.received === 530, 'property expected and received');
assert(occ.sharedCosts === 400 && occ.ownerCosts === 1000, 'shared and owner costs this year, this property only');
assert(r1.sharedCosts === 100 && r2.sharedCosts === 100 && r3.sharedCosts === 200, 'split by share 1:1:2');
assert(r1.net === 150 && r3.net === -200, 'net per room');

const future = propertyOccupancy('home', rooms, tenancies, entries, 2028, '2026-10-17');
assert(future.period === null && future.expected === 0 && future.rooms.every((r) => r.vacancyDays === 0), 'a future year has nothing due');
const past = propertyOccupancy('home', rooms, tenancies, entries, 2026, '2026-10-17');
assert(past.sharedCosts === 300 && past.rooms.every((r) => r.expected === 0), 'last year: its shared cost, no tenancies yet');
const noRooms = propertyOccupancy('empty', rooms, tenancies, [entry('2026-10-01', 'expense', 80, { shared: true, propertyId: 'empty' })], 2027, '2026-10-17');
assert(noRooms.sharedCosts === 0 && noRooms.ownerCosts === 80, 'no rooms to share with: an owner cost');

// Boarder tax figures. IRD's 2025–26 rate is in the table; 2026–27 is not set yet.
assert(IRD_BOARDER_WEEKLY_STANDARD_COST[2026]?.weekly === 245 && IRD_BOARDER_WEEKLY_STANDARD_COST[2025]?.weekly === 237, 'verified IRD rates');
const ids = ['r1', 'r2', 'r3'];
const now = boarderTaxInfo(occ, tenancies, ids, 2027);
assert(now.rate === null && now.weeklyStandardCosts === null, 'no rate for a year IRD has not set');
assert(now.boarderWeeks === 48.4 && now.mostBoardersAtOnce === 2, `boarder-weeks and peak (${now.boarderWeeks}, ${now.mostBoardersAtOnce})`);
assert(now.received === 530 && now.actualCostNet === 130, 'actual cost: received less shared costs');

const lastYearTen = [ten('r1', 200, 'weekly', '2025-04-01', '2025-04-14')];
const lastOcc = propertyOccupancy('home', rooms, lastYearTen, [], 2026, '2026-10-17');
const last = boarderTaxInfo(lastOcc, lastYearTen, ids, 2026);
assert(last.rate?.weekly === 245 && last.boarderWeeks === 2 && last.weeklyStandardCosts === 490, 'two weeks at $245');

const five = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ten(id, 200, 'weekly', `2026-05-0${i + 1}`));
const fiveRooms = five.map((t) => room(t.roomId, 1, '2026-04-01'));
const many = boarderTaxInfo(propertyOccupancy('home', fiveRooms, five, [], 2027, '2026-10-17'), five, fiveRooms.map((r) => r.id), 2027);
assert(many.mostBoardersAtOnce === 5, 'five boarders at once');

console.log('rental rooms lib tests passed');
