import type { Venue } from '@goin/shared';

export function VenueList({ venues }: { venues: Venue[] }) {
  if (venues.length === 0) return <p>No venues match.</p>;
  return (
    <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
      {venues.map((v) => (
        <li key={v.id} style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
          <strong>{v.name}</strong>
          <div style={{ color: '#666', fontSize: 14 }}>
            {v.city}, {v.country} · {v.category}
          </div>
          <a href={v.url} target="_blank" rel="noreferrer">{v.url}</a>
        </li>
      ))}
    </ul>
  );
}
