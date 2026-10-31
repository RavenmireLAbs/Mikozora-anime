import RatingBadge from './RatingBadge.jsx';
import { isAdultTitle } from '../lib/ratings.js';

function initialsFor(title) {
  const words = title
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function TitleCard({ title, onOpen }) {
  const adult = isAdultTitle(title);
  const meta = [title.year, `${title.episodes} ${title.episodes === 1 ? 'episode' : 'episodes'}`, title.source];

  return (
    <article className={`title-card${adult ? ' title-card--adult' : ''}`}>
      <button
        type="button"
        className="title-card__button"
        onClick={() => onOpen(title)}
        aria-label={`${title.title}. Rated ${title.rating}. ${title.type === 'anime' ? 'Anime' : 'Donghua'}, ${title.year}.`}
      >
        <div
          className="title-card__cover"
          style={{ '--hue': title.hue ?? 160, '--score': `${Math.min(10, title.score || 0)}` }}
          aria-hidden="true"
        >
          <span className="title-card__initials">{initialsFor(title.title)}</span>
          <span className="title-card__rail">{title.genres?.[0] || 'Series'}</span>
          <RatingBadge rating={title.rating} nsfw={title.nsfw} />
          <span className="title-card__type">{title.type === 'anime' ? 'Anime' : 'Donghua'}</span>
        </div>
        <div className="title-card__body">
          <h3 className="title-card__title">{title.title}</h3>
          <p className="title-card__meta">
            {meta.map((part) => (
              <span key={part}>{part}</span>
            ))}
          </p>
          <ul className="title-card__genres" aria-label="Genres">
            {(title.genres || []).slice(0, 3).map((genre) => (
              <li key={genre}>{genre}</li>
            ))}
          </ul>
        </div>
      </button>
    </article>
  );
}
