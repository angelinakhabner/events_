interface EmptyProps {
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}

/** Flush left like every other block on the page — a centred empty state would
 *  be the only centred thing in the whole system. No rule of its own: whatever
 *  it stands in for (a filter strip, a panel heading) has already drawn one. */
export function EmptyState({ title, hint, action }: EmptyProps) {
  return (
    <div className="py-14 md:py-20">
      <p className="font-display text-2xl md:text-[32px] text-ink m-0">{title}</p>
      {hint ? <p className="mt-2.5 text-sm text-muted max-w-[520px]">{hint}</p> : null}
      {action ? (
        <button type="button" onClick={action.onClick} className="mt-6 act act-on">
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="animate-pulse" aria-label="Loading" role="status">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="py-6 flex items-baseline gap-6 border-b-2 border-rule">
          <div className="hidden md:block w-[90px] h-4 bg-rule" />
          <div className="flex-1 space-y-2.5">
            <div className="h-6 w-2/3 bg-rule" />
            <div className="h-3 w-1/3 bg-rule/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ErrorProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message = 'Something went wrong.', onRetry }: ErrorProps) {
  return (
    <div role="alert" className="py-14 md:py-20">
      <p className="font-display text-2xl md:text-[32px] text-accent m-0">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-6 act act-on">
          Try again
        </button>
      ) : null}
    </div>
  );
}
