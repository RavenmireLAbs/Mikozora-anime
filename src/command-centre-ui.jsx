import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { searchCommands } from './command-centre.js';

const KIND_LABELS = {
  action: 'Action',
  title: 'Title',
  'planner-episode': 'Planner',
  download: 'Download',
  update: 'Release Radar',
};

export function CommandCentre({ commands = [], close, run }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const results = useMemo(() => searchCommands(commands, query, 18), [commands, query]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActiveIndex(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-command-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const choose = command => {
    if (!command) return;
    close?.();
    run?.(command);
  };

  const onKeyDown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close?.();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => Math.min(results.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  };

  return <div className="modal-backdrop command-centre-backdrop" role="presentation" onMouseDown={close}>
    <section
      className="command-centre"
      role="dialog"
      aria-modal="true"
      aria-label="Command Centre"
      onMouseDown={event => event.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <div className="command-centre-head">
        <div>
          <span className="eyebrow">COMMAND CENTRE</span>
          <h2>Jump anywhere</h2>
          <p>Searches only what Mikozora already has on this device.</p>
        </div>
        <button className="icon-btn" type="button" onClick={close} aria-label="Close Command Centre"><X size={19} /></button>
      </div>
      <label className="command-search">
        <Search size={19} />
        <input
          ref={inputRef}
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Try a series, Planner, Downloads, Stats..."
          aria-label="Search commands"
        />
        <kbd>Esc</kbd>
      </label>
      <div className="command-results" ref={listRef} role="listbox" aria-label="Command results">
        {results.length ? results.map((command, index) => <button
          key={command.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          data-command-index={index}
          className={'command-row' + (index === activeIndex ? ' active' : '')}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(command)}
        >
          <span className="command-kind">{KIND_LABELS[command.kind] || 'Command'}</span>
          <span className="command-copy"><strong>{command.title}</strong>{command.subtitle && <small>{command.subtitle}</small>}</span>
          <ArrowRight size={16} />
        </button>) : <div className="command-empty">
          <strong>No local matches</strong>
          <p>Try a saved title, a page name, or words like “planner”, “offline” and “new episode”.</p>
        </div>}
      </div>
      <p className="command-centre-hint">↑/↓ choose · Enter open · Ctrl/⌘ K opens Command Centre</p>
    </section>
  </div>;
}
