import { useState } from 'react';
import { trpc } from '../trpc';
import { VenueList } from '../components/VenueList';
import type { Category } from '@goin/shared';

export function HomePage() {
  const [category, setCategory] = useState<Category | ''>('');
  const venues = trpc.getVenues.useQuery(category ? { category } : undefined);

  return (
    <section>
      <h2>Curated venues</h2>
      <p>A default set of cultural venues. Filter, browse, or add your own.</p>

      <label style={{ display: 'block', marginBottom: 12 }}>
        Category:{' '}
        <select value={category} onChange={(e) => setCategory(e.target.value as Category | '')}>
          <option value="">All</option>
          <option value="cinema">Cinema</option>
          <option value="theatre">Theatre</option>
          <option value="exhibition">Exhibition</option>
          <option value="comedy">Comedy</option>
          <option value="music">Music</option>
        </select>
      </label>

      {venues.isLoading && <p>Loading…</p>}
      {venues.error && <p role="alert">Failed to load venues</p>}
      {venues.data && <VenueList venues={venues.data} />}
    </section>
  );
}
