import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Equipment } from '../types';

interface EquipmentPickerProps {
  options: Equipment[];
  value: string;
  onChange: (equipmentId: string) => void;
}

const labelFor = (item: Equipment) => `${item.name} · ${item.category_name ?? 'Uncategorized'}`;

// Type-to-filter replacement for a plain <select>, for long equipment lists.
export function EquipmentPicker({ options, value, onChange }: EquipmentPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((item) => String(item.id) === value);
  const term = query.trim().toLowerCase();
  const matches = term
    ? options.filter((item) => `${item.id} ${item.name} ${item.category_name ?? ''} ${item.location ?? ''}`.toLowerCase().includes(term))
    : options;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.active')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const openList = () => {
    setQuery('');
    setActiveIndex(0);
    setOpen(true);
  };

  const pick = (item: Equipment) => {
    onChange(String(item.id));
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) return openList();
      if (matches.length) setActiveIndex((index) => (index + 1) % matches.length);
    } else if (event.key === 'ArrowUp' && open && matches.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter' && open) {
      // Keep Enter from submitting the rental form while choosing equipment.
      event.preventDefault();
      if (matches[activeIndex]) pick(matches[activeIndex]);
    }
  };

  return (
    <div className="equipment-picker" ref={wrapRef}>
      <input
        type="text"
        placeholder={selected ? labelFor(selected) : 'Search equipment by name, category or location…'}
        value={open ? query : (selected ? labelFor(selected) : '')}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }}
        onFocus={openList}
        onClick={() => !open && openList()}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && (
        <div className="global-search-results equipment-picker-list" role="listbox" ref={listRef}>
          {matches.length === 0 && (
            <p className="global-search-empty">
              {options.length === 0 ? 'No available equipment' : `No available equipment matches “${query.trim()}”`}
            </p>
          )}
          {matches.map((item, index) => (
            <button
              type="button"
              key={item.id}
              role="option"
              aria-selected={String(item.id) === value}
              className={`global-search-item ${index === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(item)}
            >
              <span>
                <strong>{item.name}{String(item.id) === value ? ' ✓' : ''}</strong>
                <small>
                  {[item.category_name ?? 'Uncategorized', item.location].filter(Boolean).join(' · ')}
                  {' · ₹ '}{Number(item.daily_rent).toLocaleString()}/day
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
