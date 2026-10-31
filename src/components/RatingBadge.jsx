import { getRating } from '../lib/ratings.js';

/**
 * Small PG rating chip shown on every anime/donghua card, in details and in the
 * rating legend. Adult entries also render an "NSFW" flag so the two signals
 * (rating + source flag) are both visible.
 */
export default function RatingBadge({
  rating,
  nsfw = false,
  size = 'sm',
  showName = false,
  className = '',
}) {
  const info = getRating(rating);
  const adult = nsfw || info.id === '18+';
  const classes = [
    'rating-badge',
    `rating-badge--${size}`,
    `rating-badge--tone-${info.tone}`,
    adult ? 'is-adult' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={classes}
      title={`${info.label} — ${info.name}. ${info.description}`}
    >
      <span className="rating-badge__label">{info.label}</span>
      {showName ? <span className="rating-badge__name">{info.name}</span> : null}
      {adult ? <span className="rating-badge__flag">NSFW</span> : null}
    </span>
  );
}
