/**
 * "Get [name] set up": shown on a business card in place of zero figures when nothing is recorded
 * in the tax year. Each step ticks off once it's done. Money in comes from an invoice or tagged
 * income; costs only from tagged bank transactions, so both tag steps open the tag picker.
 */
import { Link } from 'react-router-dom';
import { setupSteps } from '../../lib/business';
import type { BusinessCard } from '../../types';

export function BusinessSetup({ b }: { b: BusinessCard }) {
  const steps = setupSteps(b.totals, b.activity);
  const name = b.name || 'this business';
  const tagHref = `/business/${b.id}?tag=1`;
  const action: Record<(typeof steps)[number]['id'], { hint: string; links: { to: string; label: string; aria: string }[] }> = {
    money_in: {
      hint: 'Send an invoice, or tag income you recorded on Income.',
      links: [
        { to: `/business/invoices/new?business=${encodeURIComponent(b.id)}`, label: '+ Invoice', aria: `New invoice for ${name}` },
        { to: tagHref, label: 'Tag income', aria: `Tag income to ${name}` },
      ],
    },
    cost: {
      hint: 'Costs come from bank transactions you tag to the business.',
      links: [{ to: tagHref, label: 'Tag a cost', aria: `Tag a cost to ${name}` }],
    },
    tag: {
      hint: 'Pick transactions from Budget that belong to this business.',
      links: [{ to: tagHref, label: 'Tag transactions', aria: `Tag transactions to ${name}` }],
    },
  };
  const left = steps.filter((s) => !s.done).length;
  return (
    <section className="business-setup" aria-label={`Get ${name} set up`}>
      <h5 className="business-setup-title">
        Get {name} set up <span className="muted small">· {left === 0 ? 'all done' : `${3 - left} of 3 done`}</span>
      </h5>
      <ol className="business-setup-steps">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? 'is-done' : undefined}>
            <span className="business-setup-check" aria-hidden="true">
              {s.done ? '✓' : ''}
            </span>
            <span className="business-setup-text">
              <span className="business-setup-step">
                {s.title}
                <span className="sr-only">{s.done ? ' (done)' : ' (not done yet)'}</span>
              </span>
              {s.done ? null : (
                <span className="muted small">
                  {action[s.id].hint}{' '}
                  {action[s.id].links.map((l, i) => (
                    <span key={l.label}>
                      {i > 0 ? ' · ' : ''}
                      <Link to={l.to} aria-label={l.aria}>
                        {l.label}
                      </Link>
                    </span>
                  ))}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
