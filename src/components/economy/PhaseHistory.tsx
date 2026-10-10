import type { EconomicCycleResponse } from '../../types/economy';

function nextQuarter(period: string): string | null {
  const match = period.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return null;
  let year = Number(match[1]);
  let quarter = Number(match[2]) + 1;
  if (quarter === 5) {
    quarter = 1;
    year += 1;
  }
  return `${year}-Q${quarter}`;
}

/** Calculated phase by quarter (latest-vintage replay). Collapsed by default. */
export function PhaseHistory({ data }: { data: EconomicCycleResponse }) {
  return (
    <section className="panel econ-history" aria-labelledby="econ-history-title">
      <details>
        <summary>
          <h2 id="econ-history-title">Phase history</h2>
          <span className="muted small">
            {data.timeline.length > 0
              ? ` ${data.timeline.length} quarters, ${data.timeline[0]!.label} to ${data.timeline.at(-1)!.label}`
              : ' No scored quarters'}
          </span>
        </summary>
        <p className="muted small">{data.vintageNote}</p>
        <PhaseChart points={data.timeline} />
      </details>
    </section>
  );
}

function PhaseChart({ points }: { points: EconomicCycleResponse['timeline'] }) {
  if (points.length < 2) {
    return <p className="muted">Not enough quarters to draw a phase history.</p>;
  }
  const order = ['recovery', 'expansion', 'late_expansion', 'slowdown', 'recession'];
  const labels = ['Recovery', 'Expansion', 'Late Expansion', 'Slowdown', 'Recession'];
  const width = Math.max(720, points.length * 16 + 150);
  const height = 220;
  const left = 118;
  const top = 16;
  const plotW = width - left - 12;
  const plotH = height - top - 28;
  const yFor = (phase: string) => top + (order.indexOf(phase) + 0.5) * (plotH / order.length);
  const xFor = (index: number) => left + (points.length === 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);

  const segments: string[] = [];
  let segment = '';
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const cmd = `${xFor(i).toFixed(1)},${yFor(point.phase).toFixed(1)}`;
    if (!segment) segment = `M ${cmd}`;
    else segment += ` L ${cmd}`;
    const follows = i + 1 < points.length && points[i + 1]?.period === nextQuarter(point.period);
    if (!follows) {
      segments.push(segment);
      segment = '';
    }
  }

  return (
    <>
      <div className="phase-chart-wrap">
        <svg className="phase-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Phase by quarter">
          {labels.map((label, index) => (
            <text key={label} x={8} y={yFor(order[index]!) + 4} className="phase-chart-label">
              {label}
            </text>
          ))}
          {segments.map((d) => (
            <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
          ))}
          {points.map((point, index) => (
            <circle
              key={point.period}
              cx={xFor(index)}
              cy={yFor(point.phase)}
              r={point.period === points[points.length - 1]?.period ? 4.5 : 3}
              className={`phase-dot phase-${point.phase}`}
            >
              <title>{`${point.label}: ${point.phaseLabel}, confidence ${point.confidence}%`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <details className="econ-phase-table">
        <summary>Phase by quarter</summary>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Quarter</th>
                <th>Phase</th>
                <th>Score</th>
                <th>Confidence</th>
                <th>Momentum</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((point) => (
                <tr key={point.period}>
                  <td>{point.label}</td>
                  <td>{point.phaseLabel}</td>
                  <td>{point.score}</td>
                  <td>{point.confidence}%</td>
                  <td>{point.momentum}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
