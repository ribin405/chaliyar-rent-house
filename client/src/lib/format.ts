// "Belt sheet × 5" for rental lines taking several units; plain name for one.
export const itemLabel = (name: string, quantity = 1) => (quantity > 1 ? `${name} × ${quantity}` : name);
