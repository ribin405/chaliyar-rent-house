import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Wrench, ClipboardList } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { SearchResults } from '../types';

const DEBOUNCE_MS = 250;
const EMPTY_RESULTS: SearchResults = { customers: [], equipment: [], rentals: [] };

interface ResultItem {
  key: string;
  icon: typeof Users;
  title: string;
  subtitle: string;
  to: string;
  search: string;
}

const toItems = (results: SearchResults): Array<{ heading: string; items: ResultItem[] }> => [
  {
    heading: 'Customers',
    items: results.customers.map((customer) => ({
      key: `c-${customer.id}`,
      icon: Users,
      title: customer.full_name,
      subtitle: [customer.phone_number, customer.alternate_phone].filter(Boolean).join(' / '),
      to: '/customers',
      search: customer.phone_number,
    })),
  },
  {
    heading: 'Equipment',
    items: results.equipment.map((item) => ({
      key: `e-${item.id}`,
      icon: Wrench,
      title: item.name,
      subtitle: [item.category_name, item.status, item.location].filter(Boolean).join(' · '),
      to: '/equipment',
      search: item.name,
    })),
  },
  {
    heading: 'Rentals',
    items: results.rentals.map((rental) => ({
      key: `r-${rental.id}`,
      icon: ClipboardList,
      title: `${rental.invoice_number} — ${rental.customer_name}`,
      subtitle: `${rental.equipment_name} · ${rental.customer_phone} · ${rental.status}`,
      to: '/rentals',
      search: rental.invoice_number,
    })),
  },
].filter((group) => group.items.length > 0);

export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      apiRequest<SearchResults>(`/search?q=${encodeURIComponent(term)}`)
        .then((data) => {
          if (cancelled) return;
          setResults(data);
          setError('');
          setActiveIndex(0);
        })
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Search failed'))
        .finally(() => !cancelled && setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const groups = toItems(results);
  const flatItems = groups.flatMap((group) => group.items);

  const select = (item: ResultItem) => {
    navigate(item.to, { state: { search: item.search } });
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'ArrowDown' && flatItems.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % flatItems.length);
    } else if (event.key === 'ArrowUp' && flatItems.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + flatItems.length) % flatItems.length);
    } else if (event.key === 'Enter' && flatItems[activeIndex]) {
      event.preventDefault();
      select(flatItems[activeIndex]);
    }
  };

  const showDropdown = open && query.trim().length >= 2;

  return (
    <div className="global-search" ref={wrapRef}>
      <Search size={16} className="global-search-icon" />
      <input
        type="search"
        placeholder="Search customers, phone, equipment, invoice…"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        aria-label="Global search"
      />
      {showDropdown && (
        <div className="global-search-results" role="listbox">
          {error && <p className="global-search-empty form-error">{error}</p>}
          {!error && loading && flatItems.length === 0 && <p className="global-search-empty">Searching…</p>}
          {!error && !loading && flatItems.length === 0 && <p className="global-search-empty">No matches for “{query.trim()}”</p>}
          {groups.map((group) => (
            <div key={group.heading}>
              <p className="global-search-heading">{group.heading}</p>
              {group.items.map((item) => {
                const index = flatItems.indexOf(item);
                return (
                  <button
                    type="button"
                    key={item.key}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`global-search-item ${index === activeIndex ? 'active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(item)}
                  >
                    <item.icon size={16} />
                    <span>
                      <strong>{item.title}</strong>
                      {item.subtitle && <small>{item.subtitle}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
