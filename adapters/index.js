// Adapter registry. Adding a source is one module plus one line here.

import charlotte311 from './charlotte-311.js';
import federalRegister from './federal-register.js';

export const adapters = [charlotte311, federalRegister];

export function getAdapter(id) {
  const found = adapters.find((adapter) => adapter.id === id);
  if (!found) throw new Error(`unknown adapter: ${id}`);
  return found;
}

export default adapters;
