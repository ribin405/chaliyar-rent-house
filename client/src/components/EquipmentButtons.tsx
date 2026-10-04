import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Equipment } from '../types';

const ALL = '__all__';
const UNCATEGORIZED = 'Other';

interface EquipmentButtonsProps {
  equipment: Equipment[];
  // Units of each equipment already in the order being built.
  inOrder: Map<number, number>;
  onAdd: (item: Equipment) => void;
}

// Tap-to-add equipment grid for building an order, grouped into category tabs.
// Each tap adds one unit; an item is disabled once every free unit is in the order.
export function EquipmentButtons({ equipment, inOrder, onAdd }: EquipmentButtonsProps) {
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState('');

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    equipment.forEach((item) => {
      const name = item.category_name ?? UNCATEGORIZED;
      counts.set(name, (counts.get(name) ?? 0) + (item.available_quantity > 0 ? 1 : 0));
    });
    return [...counts.entries()]
      .sort(([a], [b]) => (a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : a.localeCompare(b)));
  }, [equipment]);

  const term = query.trim().toLowerCase();
  const visible = equipment
    .filter((item) => category === ALL || (item.category_name ?? UNCATEGORIZED) === category)
    .filter((item) => !term || `${item.name} ${item.category_name ?? ''}`.toLowerCase().includes(term))
    // Rentable items first, then alphabetical.
    .sort((a, b) => Number(b.available_quantity > 0) - Number(a.available_quantity > 0) || a.name.localeCompare(b.name));

  return (
    <div className="equipment-buttons">
      <div className="equipment-buttons-bar">
        <label className="desk-search">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search equipment…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="category-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={category === ALL} className={category === ALL ? 'active' : ''} onClick={() => setCategory(ALL)}>
          All
        </button>
        {categories.map(([name, available]) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={category === name}
            className={category === name ? 'active' : ''}
            onClick={() => setCategory(name)}
          >
            {name} <span className="count">{available}</span>
          </button>
        ))}
      </div>
      <div className="equipment-grid">
        {visible.map((item) => {
          const taken = inOrder.get(item.id) ?? 0;
          const left = item.available_quantity - taken;
          const unavailable = item.available_quantity <= 0;
          return (
            <button
              key={item.id}
              type="button"
              className={`equipment-tile ${taken ? 'in-order' : ''}`}
              disabled={left <= 0}
              onClick={() => onAdd(item)}
              title={unavailable ? `${item.name} is ${item.status}` : left <= 0 ? 'All free units are in this order' : `Add one ${item.name}`}
            >
              {taken > 0 && <span className="tile-count">×{taken}</span>}
              <strong>{item.name}</strong>
              <small>₹ {Number(item.daily_rent).toLocaleString()}/day</small>
              <small className={`tile-stock ${unavailable ? 'out' : ''}`}>
                {unavailable
                  ? (item.status === 'maintenance' ? 'Maintenance' : item.status === 'reserved' ? 'Reserved' : 'All out')
                  : item.stock_quantity > 1 ? `${left} of ${item.stock_quantity} free` : left > 0 ? 'Available' : 'In order'}
              </small>
            </button>
          );
        })}
        {visible.length === 0 && <p className="global-search-empty">No equipment matches.</p>}
      </div>
    </div>
  );
}
