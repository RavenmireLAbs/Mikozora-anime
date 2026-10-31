import { RotateCcw, Shield, ShieldOff } from 'lucide-react';
import RatingBadge from './RatingBadge.jsx';
import { RATINGS } from '../lib/ratings.js';

function Switch({ id, checked, onChange, label }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__thumb" aria-hidden="true" />
    </button>
  );
}

export default function SettingsPage({
  prefs,
  onChangePrefs,
  adultCount,
  filteredAdultVisible,
  onResetFilters,
  onIncludeAdultInBrowse,
}) {
  const allowed = prefs.allowNsfw === true;

  return (
    <div className="settings">
      <div className="settings__intro">
        <h1>Settings</h1>
        <p className="browse__subtitle">Content controls for this device. Changes save automatically.</p>
      </div>

      <section className="settings-card" aria-labelledby="adult-heading">
        <div className="settings-card__row">
          <div className="settings-card__text">
            <h2 id="adult-heading" className="settings-card__title">
              {allowed ? <Shield size={18} aria-hidden="true" /> : <ShieldOff size={18} aria-hidden="true" />}
              Adult content (NSFW)
            </h2>
            <p>
              {allowed
                ? '18+ titles can appear when the Browse NSFW filter is set to Include or Only 18+. Turn this off to remove them from Moku entirely.'
                : 'NSFW titles are switched off across Moku: Browse, search, rails and title details. The per-Browse NSFW filter cannot re-enable them.'}
            </p>
            <p className="settings-card__meta">
              {adultCount} {adultCount === 1 ? 'title in' : 'titles in'} the catalogue {adultCount === 1 ? 'is' : 'are'} rated
              18+.
              {!allowed && adultCount > 0
                ? ` All ${adultCount} are currently hidden.`
                : filteredAdultVisible === 0 && allowed
                  ? ' None match the current Browse filter.'
                  : ''}
            </p>
          </div>
          <div className="settings-card__control">
            <span className="switch-label">{allowed ? 'On' : 'Off'}</span>
            <Switch
              id="setting-nsfw"
              checked={allowed}
              label="Allow adult (NSFW) titles"
              onChange={(next) => onChangePrefs({ allowNsfw: next })}
            />
          </div>
        </div>

        {allowed ? (
          <div className="settings-card__footer">
            <button type="button" className="button button--ghost" onClick={onIncludeAdultInBrowse}>
              Show 18+ titles in Browse now
            </button>
            <p className="settings-card__hint">
              This also sets the Browse NSFW filter to “Include”. You can switch it back to “Hide 18+” at any time
              without turning adult content off for the whole app.
            </p>
          </div>
        ) : (
          <p className="settings-card__hint">
            Turning this on only unlocks the option. NSFW titles stay hidden in Browse until you choose Include or
            Only 18+ in the NSFW filter.
          </p>
        )}
      </section>

      <section className="settings-card" aria-labelledby="ratings-heading">
        <h2 id="ratings-heading" className="settings-card__title">
          Content ratings
        </h2>
        <p className="settings-card__intro">
          Every anime and donghua card and details screen shows a PG rating. The rating is guidance from the source
          and Moku’s local classification, not a guarantee of every scene.
        </p>
        <ul className="rating-legend">
          {RATINGS.map((rating) => (
            <li key={rating.id} className="rating-legend__item">
              <RatingBadge rating={rating.id} size="md" />
              <div>
                <p className="rating-legend__name">{rating.name}</p>
                <p className="rating-legend__description">{rating.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="settings-card" aria-labelledby="filters-heading">
        <h2 id="filters-heading" className="settings-card__title">
          Saved Browse filters
        </h2>
        <p className="settings-card__intro">
          Genre, year, source, status, NSFW and sort choices are remembered on this device and are kept separately
          from your library, collections and history.
        </p>
        <button type="button" className="button button--ghost" onClick={onResetFilters}>
          <RotateCcw size={14} aria-hidden="true" />
          Reset Browse filters
        </button>
      </section>
    </div>
  );
}
