import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import RatingBadge from './RatingBadge.jsx';
import { getRating, isAdultTitle } from '../lib/ratings.js';

export default function DetailDialog({ title, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!title) return null;

  const adult = isAdultTitle(title);
  const rating = getRating(title.rating);
  const facts = [
    ['Type', title.type === 'anime' ? 'Anime' : 'Donghua'],
    ['Released', String(title.year)],
    ['Episodes', String(title.episodes)],
    ['Status', title.status],
    ['Score', `${title.score.toFixed(1)} / 10`],
    ['Source', title.source],
  ];

  return (
    <div className="dialog-layer">
      <div className="dialog-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        aria-describedby="detail-synopsis"
      >
        <button
          type="button"
          ref={closeRef}
          className="icon-button dialog__close"
          onClick={onClose}
          aria-label="Close title details"
        >
          <X size={18} aria-hidden="true" />
        </button>

        <div className="dialog__hero" style={{ '--hue': title.hue ?? 160 }} aria-hidden="true">
          <span className="dialog__initials">{title.title.slice(0, 2).toUpperCase()}</span>
        </div>

        <div className="dialog__content">
          <div className="dialog__badges">
            <RatingBadge rating={title.rating} nsfw={title.nsfw} size="md" />
            <span className="pill">{title.type === 'anime' ? 'Anime' : 'Donghua'}</span>
            {adult ? <span className="pill pill--adult">NSFW</span> : null}
          </div>

          <h2 id="detail-title" className="dialog__title">
            {title.title}
          </h2>
          {title.altTitle ? <p className="dialog__alt">{title.altTitle}</p> : null}

          <ul className="dialog__genres" aria-label="Genres">
            {(title.genres || []).map((genre) => (
              <li key={genre}>{genre}</li>
            ))}
          </ul>

          <p id="detail-synopsis" className="dialog__synopsis">
            {title.synopsis}
          </p>

          <div className={`rating-callout rating-callout--${rating.tone}`}>
            <div>
              <p className="rating-callout__name">
                {rating.label} · {rating.name}
              </p>
              <p className="rating-callout__description">{rating.description}</p>
            </div>
          </div>

          {adult ? (
            <p className="dialog__adult-note">
              This is adult content. It is hidden by default and only appears while adult content is allowed in
              Settings and the Browse NSFW filter includes 18+ titles.
            </p>
          ) : null}

          <dl className="dialog__facts">
            {facts.map(([term, value]) => (
              <div key={term} className="dialog__fact">
                <dt>{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          <p className="dialog__footnote">
            Listings, artwork and episode availability come from {title.source} at runtime and may change.
          </p>
        </div>
      </div>
    </div>
  );
}
