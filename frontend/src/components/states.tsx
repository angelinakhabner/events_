interface EmptyProps {
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ title, hint, action }: EmptyProps) {
  return (
    <div className="py-20 text-center">
      <p className="font-serif text-xl text-ink">{title}</p>
      {hint ? <p className="mt-2 text-sm text-muted">{hint}</p> : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-6 link-accent text-sm bg-transparent border-0 cursor-pointer"
        >
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
        <div key={i} className="py-6 flex items-baseline gap-6">
          <div className="w-16 h-4 bg-rule rounded" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-2/3 bg-rule rounded" />
            <div className="h-3 w-1/3 bg-rule/70 rounded" />
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
    <div role="alert" className="py-20 text-center">
      <p className="font-serif text-xl">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 link-accent text-sm bg-transparent border-0 cursor-pointer"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
