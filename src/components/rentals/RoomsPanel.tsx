/**
 * Rooms of a property let by room (KAN-83): who is in each room, rent expected so far this
 * tax year against rent recorded, vacancy days, each room's part of the shared costs, and
 * the tenancies. For your own home, IRD's two methods for boarders are shown as information.
 */
import { formatNzd } from '../../api/client';
import {
  IRD_BOARDERS_URL,
  IRD_STANDARD_COST_MAX_BOARDERS,
  boarderTaxInfo,
  propertyOccupancy,
  rentFrequencyPer,
} from '../../lib/rentalRooms';
import { taxYearLabel } from '../../lib/rental';
import { longDate } from '../../pages/warrantiesView';
import type { RentalEntry, RentalProperty, RentalRoom, RentalTenancy } from '../../types';

export type RoomActions = {
  onAddRoom: () => void;
  onEditRoom: (room: RentalRoom) => void;
  onDeleteRoom: (room: RentalRoom) => void;
  onAddTenancy: (room: RentalRoom) => void;
  onEditTenancy: (room: RentalRoom, t: RentalTenancy) => void;
  onDeleteTenancy: (t: RentalTenancy) => void;
  onRecordRent: (room: RentalRoom, t: RentalTenancy | null) => void;
};

function tenancyTerms(t: RentalTenancy): string {
  const parts = [`${formatNzd(t.rentAmount)} a ${rentFrequencyPer(t.rentFrequency)}`];
  if (t.billsIncluded) parts.push('bills included');
  if (t.bondAmount > 0) parts.push(`bond ${formatNzd(t.bondAmount)} ${t.bondLodged ? '(lodged)' : '(not lodged)'}`);
  return parts.join(' · ');
}

function tenancyDates(t: RentalTenancy): string {
  return t.endDate ? `${longDate(t.startDate)} – ${longDate(t.endDate)}` : `From ${longDate(t.startDate)}`;
}

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function RoomsPanel({ property, rooms, tenancies, entries, year, today, busy, actions }: {
  property: RentalProperty;
  rooms: RentalRoom[];
  tenancies: RentalTenancy[];
  entries: RentalEntry[];
  year: number;
  today: string;
  busy: boolean;
  actions: RoomActions;
}) {
  const mine = rooms.filter((r) => r.propertyId === property.id);
  const occ = propertyOccupancy(property.id, mine, tenancies, entries, year, today);
  const byRoom = new Map(occ.rooms.map((r) => [r.roomId, r]));
  const periodText = occ.period ? `${shortDate(occ.period.start)} – ${shortDate(occ.period.end)}` : `${taxYearLabel(year)} hasn’t started`;

  return (
    <section className="rental-rooms" aria-label={`Rooms at ${property.name}`}>
      <div className="rental-rooms-head">
        <h5>Rooms</h5>
        <button type="button" className="btn small" disabled={busy} onClick={actions.onAddRoom}>
          + Room
        </button>
      </div>
      {mine.length === 0 ? (
        <p className="muted small">Add each room you let to see which are occupied and the rent you’re owed.</p>
      ) : (
        <>
          <p className="muted small rental-summary-label">Rent so far · {periodText}</p>
          <dl className="rental-totals">
            <div>
              <dt>Rooms let</dt>
              <dd>
                {occ.occupied} of {mine.length}
                {occ.vacant > 0 ? <span className="rental-vacant-count"> · {occ.vacant} vacant</span> : null}
              </dd>
            </div>
            <div>
              <dt>Expected</dt>
              <dd>{formatNzd(occ.expected)}</dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd className={occ.received + 0.005 < occ.expected ? 'rental-net--loss' : undefined}>{formatNzd(occ.received)}</dd>
            </div>
          </dl>
          <ul className="rental-room-list">
            {mine.map((room) => {
              const o = byRoom.get(room.id)!;
              const own = tenancies.filter((t) => t.roomId === room.id);
              const current = o.current ? own.find((t) => t.id === o.current!.id) ?? null : null;
              const upcoming = !current ? [...own].filter((t) => t.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0] : undefined;
              return (
                <li key={room.id} className="rental-room">
                  <div className="rental-room-head">
                    <div className="rental-entry-what">
                      <span className="rental-room-name">{room.name}</span>
                      {room.note ? <span className="muted small">{room.note}</span> : null}
                    </div>
                    <span className={'rental-room-status' + (current ? ' rental-room-status--let' : '')}>
                      {current ? `Let to ${current.tenantLabel}` : 'Vacant'}
                    </span>
                  </div>
                  {current ? (
                    <p className="small rental-room-terms">{tenancyTerms(current)}</p>
                  ) : upcoming ? (
                    <p className="muted small rental-room-terms">
                      {upcoming.tenantLabel} moves in {longDate(upcoming.startDate)}
                    </p>
                  ) : null}
                  <dl className="rental-room-figures">
                    <div>
                      <dt>Expected</dt>
                      <dd>{formatNzd(o.expected)}</dd>
                    </div>
                    <div>
                      <dt>Received</dt>
                      <dd>{formatNzd(o.received)}</dd>
                    </div>
                    <div>
                      <dt>Vacant</dt>
                      <dd>
                        {o.vacancyDays} {o.vacancyDays === 1 ? 'day' : 'days'}
                      </dd>
                    </div>
                    {occ.sharedCosts > 0 ? (
                      <div>
                        <dt>Shared costs</dt>
                        <dd>−{formatNzd(o.sharedCosts)}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Net</dt>
                      <dd className={o.net < 0 ? 'rental-net--loss' : undefined}>{formatNzd(o.net)}</dd>
                    </div>
                  </dl>
                  <div className="rental-card-actions">
                    <button type="button" className="btn small" disabled={busy} onClick={() => actions.onRecordRent(room, current)}>
                      Record rent
                    </button>
                    <button type="button" className="btn small" disabled={busy} onClick={() => actions.onAddTenancy(room)}>
                      + Tenancy
                    </button>
                    <button type="button" className="link-btn" disabled={busy} onClick={() => actions.onEditRoom(room)}>
                      Edit
                    </button>
                    <button type="button" className="link-btn" disabled={busy} onClick={() => actions.onDeleteRoom(room)}>
                      Delete
                    </button>
                  </div>
                  {own.length > 0 ? (
                    <details className="rental-tenancies">
                      <summary className="small">
                        {own.length === 1 ? '1 tenancy' : `${own.length} tenancies`}
                      </summary>
                      <ul className="rental-entries">
                        {own.map((t) => (
                          <li key={t.id} className="rental-entry">
                            <div className="rental-entry-what">
                              <span>{t.tenantLabel}</span>
                              <span className="muted small">
                                {tenancyDates(t)} · {tenancyTerms(t)}
                              </span>
                            </div>
                            <span />
                            <span className="rental-entry-actions">
                              <button type="button" className="link-btn" disabled={busy} onClick={() => actions.onEditTenancy(room, t)}>
                                Edit
                              </button>
                              <button type="button" className="link-btn" disabled={busy} onClick={() => actions.onDeleteTenancy(t)}>
                                Delete
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {occ.sharedCosts > 0 || occ.ownerCosts > 0 ? (
            <p className="muted small">
              {taxYearLabel(year)}: shared costs {formatNzd(occ.sharedCosts)} split across the rooms by share · owner costs{' '}
              {formatNzd(occ.ownerCosts)}
            </p>
          ) : null}
        </>
      )}
      {property.ownHome && mine.length > 0 ? <BoarderTaxNote occ={occ} tenancies={tenancies} roomIds={mine.map((r) => r.id)} year={year} /> : null}
    </section>
  );
}

function BoarderTaxNote({ occ, tenancies, roomIds, year }: {
  occ: ReturnType<typeof propertyOccupancy>;
  tenancies: RentalTenancy[];
  roomIds: string[];
  year: number;
}) {
  const info = boarderTaxInfo(occ, tenancies, roomIds, year);
  return (
    <details className="rental-tax-note">
      <summary>Boarders and tax: IRD’s two methods</summary>
      <p className="small">
        If you take in boarders in your own home, IRD lets you work out the taxable part of the rent with either the{' '}
        <strong>standard-cost method</strong> or the <strong>actual-cost method</strong>. The figures below come from what
        you’ve entered for {taxYearLabel(year)} so far, as a starting point only.
      </p>
      <dl className="rental-room-figures">
        <div>
          <dt>Rent received</dt>
          <dd>{formatNzd(info.received)}</dd>
        </div>
        <div>
          <dt>Boarder-weeks</dt>
          <dd>{info.boarderWeeks}</dd>
        </div>
        <div>
          <dt>IRD weekly rate</dt>
          <dd>{info.rate ? `${formatNzd(info.rate.weekly)} per boarder` : 'Not set yet'}</dd>
        </div>
      </dl>
      <ul className="small rental-tax-list">
        <li>
          <strong>Standard cost:</strong>{' '}
          {info.weeklyStandardCosts != null ? (
            <>
              at IRD’s {taxYearLabel(year)} rate, the weekly standard costs come to {formatNzd(info.weeklyStandardCosts)} (
              <a href={info.rate!.source} target="_blank" rel="noreferrer">
                IRD determination
              </a>
              ). IRD also has housing and transport standard costs, which aren’t included here.
            </>
          ) : (
            <>
              IRD sets the weekly rate for {taxYearLabel(year)} after the tax year ends, usually in May, so it isn’t shown yet.
            </>
          )}{' '}
          The method covers up to {IRD_STANDARD_COST_MAX_BOARDERS} boarders at a time.
          {info.mostBoardersAtOnce > IRD_STANDARD_COST_MAX_BOARDERS
            ? ` You had ${info.mostBoardersAtOnce} at once, so IRD says it doesn’t apply.`
            : ''}
        </li>
        <li>
          <strong>Actual cost:</strong> rent received less the rooms’ share of the shared costs here comes to{' '}
          {formatNzd(info.actualCostNet)}. IRD’s rules decide which other costs, such as owner costs, count.
        </li>
      </ul>
      <p className="muted small">
        Who can use each method, and what counts, is set by IRD.{' '}
        <a href={IRD_BOARDERS_URL} target="_blank" rel="noreferrer">
          Read IRD’s guide to boarders
        </a>
        . This is general information, not tax advice.
      </p>
    </details>
  );
}
