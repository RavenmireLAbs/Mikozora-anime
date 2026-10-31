// PG-style content ratings used across anime and donghua entries.
//
// Every catalogue title carries exactly one rating. Adult (NSFW) titles are
// rated `18+`, and may additionally carry `nsfw: true` when a source flags the
// entry itself. `isAdultTitle()` treats either signal as adult so a source that
// only supplies one of them cannot leak into an NSFW-hidden listing.

export const RATINGS = Object.freeze([
  Object.freeze({
    id: 'G',
    label: 'G',
    name: 'General audiences',
    minAge: 0,
    tone: 'all',
    description: 'Suitable for all ages. No nudity, sexual content, graphic violence or strong language.',
  }),
  Object.freeze({
    id: 'PG',
    label: 'PG',
    name: 'Parental guidance',
    minAge: 7,
    tone: 'mild',
    description: 'Mild action or comedy. Younger viewers should watch with a parent or guardian.',
  }),
  Object.freeze({
    id: 'PG-13',
    label: 'PG-13',
    name: 'Teens 13 and up',
    minAge: 13,
    tone: 'teen',
    description: 'Fantasy or action violence, some blood, suggestive humour or mild language.',
  }),
  Object.freeze({
    id: 'R-17',
    label: 'R-17',
    name: 'Mature 17 and up',
    minAge: 17,
    tone: 'mature',
    description: 'Strong violence, disturbing themes, coarse language or non-explicit sexual references. Not adult content.',
  }),
  Object.freeze({
    id: '18+',
    label: '18+',
    name: 'Adults only (NSFW)',
    minAge: 18,
    tone: 'adult',
    description: 'Explicit sexual content. Hidden by default and removed entirely while adult content is turned off.',
  }),
]);

export const RATING_IDS = Object.freeze(RATINGS.map((rating) => rating.id));

export const ADULT_RATING_ID = '18+';

const RATING_MAP = new Map(RATINGS.map((rating) => [rating.id, rating]));

const UNRATED = Object.freeze({
  id: 'NR',
  label: 'NR',
  name: 'Not rated',
  minAge: null,
  tone: 'unknown',
  description: 'The source did not provide a content rating for this title.',
});

/** Look up rating metadata, falling back to a visible "not rated" entry. */
export function getRating(id) {
  return RATING_MAP.get(id) || UNRATED;
}

/** True when a title must be treated as adult / NSFW. */
export function isAdultTitle(title) {
  if (!title) return false;
  return Boolean(title.nsfw) || title.rating === ADULT_RATING_ID;
}

/** Short, human readable rating caption, e.g. "PG-13 · Teens 13 and up". */
export function describeRating(id) {
  const rating = getRating(id);
  return `${rating.label} · ${rating.name}`;
}
