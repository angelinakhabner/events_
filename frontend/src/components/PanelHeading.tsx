/**
 * The header every /my panel opens with: an Anton title, one line of plain
 * explanation, and the heavy rule that starts the content beneath it.
 *
 * Panels that lead with their own filter strip (Events) pass `rule={false}` —
 * the chip row already carries a 3px ink rule of its own, and two in a row
 * reads as a mistake.
 */
export function PanelHeading({
  title,
  blurb,
  rule = true,
  action,
}: {
  title: string;
  blurb?: string;
  rule?: boolean;
  /** Optional control aligned to the right of the title (e.g. "Add venue"). */
  action?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="font-display text-[28px] md:text-[36px] m-0">{title}</h2>
        {action}
      </div>
      {blurb ? (
        <p className="mt-1.5 mb-5 md:mb-6 max-w-[520px] text-sm md:text-base text-body">{blurb}</p>
      ) : null}
      {rule ? <div className="rule-ink" /> : null}
    </>
  );
}
