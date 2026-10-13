/**
 * Heading shared by every Portfolio class tab: the class name (with an optional ⓘ),
 * the class total from the portfolio summary (the same figure as its Overview row),
 * and optional controls on the right.
 */
import type { ReactNode } from 'react';
import { formatNzd } from '../../api/client';

export function ClassHeading({
  id,
  title,
  info,
  total,
  children,
}: {
  id?: string;
  title: string;
  info?: ReactNode;
  /** Null while the summary is loading. */
  total: number | null;
  children?: ReactNode;
}) {
  return (
    <div className="panel-heading class-heading">
      <div className="class-heading-title">
        <h3 id={id}>
          {title}
          {info}
        </h3>
        <p className="class-heading-total money">{total == null ? '—' : formatNzd(total)}</p>
      </div>
      {children}
    </div>
  );
}
