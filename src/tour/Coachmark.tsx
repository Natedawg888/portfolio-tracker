/**
 * Coachmark card for the onboarding tour. Presentational: the provider measures
 * the target, scrolls, and chooses phone vs desktop placement.
 * Text buttons only. Theme colours follow html[data-theme] in tour.css.
 */
import { useId, type CSSProperties, type Ref } from 'react';
import { primaryActionLabel, stepCounterLabel, type CoachmarkPlacement } from './engine.ts';

export function Coachmark({
  title,
  body,
  index,
  total,
  placement,
  reducedMotion,
  style,
  cardRef,
  onBack,
  onNext,
  onSkip,
}: {
  title: string;
  body: string;
  index: number;
  total: number;
  placement: CoachmarkPlacement;
  reducedMotion: boolean;
  style?: CSSProperties;
  cardRef?: Ref<HTMLDivElement>;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const stepId = `${uid}-step`;
  const bodyId = `${uid}-body`;
  const label = stepCounterLabel(index, total);
  const primary = primaryActionLabel(index, total);
  const classes = [
    'tour-card',
    placement === 'sheet-bottom' ? 'tour-card--sheet-bottom' : '',
    placement === 'sheet-top' ? 'tour-card--sheet-top' : '',
    reducedMotion ? 'tour-card--still' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={cardRef}
      className={classes}
      style={style}
      tabIndex={-1}
      role="region"
      aria-labelledby={`${stepId} ${titleId}`}
      aria-describedby={bodyId}
      data-tour-ui="coachmark"
    >
      <p id={stepId} className="sr-only">
        {label}
      </p>
      <h2 id={titleId} className="tour-card-title">
        {title}
      </h2>
      <p id={bodyId} className="tour-card-body">
        {body}
      </p>
      <div className="tour-dots" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i === index ? 'tour-dot is-current' : 'tour-dot'} />
        ))}
      </div>
      <div className="tour-actions">
        <div className="tour-actions-nav">
          <button type="button" className="tour-btn tour-btn--outline" onClick={onBack} disabled={index <= 0}>
            Back
          </button>
          <button type="button" className="tour-btn tour-btn--primary" onClick={onNext}>
            {primary}
          </button>
        </div>
        <button type="button" className="tour-skip" onClick={onSkip}>
          Skip tour
        </button>
      </div>
    </div>
  );
}
