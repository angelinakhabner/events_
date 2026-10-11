import { env } from '../config.js';
import { PL, festivalSpan, time, weekday } from './newsletter-copy.js';
import {
  AFISZKA, barSpan, buildAfiszkaIssue, dateRun, dayNumber, describe, frontWhen, isReferenced,
  entryWhen, metaLine, pickReasonLabel, monthAbbr, runLabel,
  type AfiszkaBlock, type AfiszkaContent, type AfiszkaEntry, type AfiszkaIssue, type AfiszkaSection,
} from './newsletter-afiszka.js';

/**
 * The AFISZ.KA newsletter (the redesign handoff) as an email.
 *
 * The design reference is an A4 print piece; this is the same issue drawn for
 * a 600px mail column. Like the classic brief it is send-safe markup — nested
 * presentation tables, every style inline — because Outlook renders through
 * Word and supports none of the flex and grid the reference is mocked in.
 * Archivo is linked for the clients that load webfonts and degrades to the
 * grotesques every client has.
 *
 * Sheets do not exist in an email, so the paper's "Sheet 2" cross-references
 * become "further up" and the page breaks become plain section headings.
 */

const WIDTH = 600;
const PAD = 32;

/** Modernist tokens (handoff §9), flattened to hex for mail clients. */
export const PC = {
  bg: '#f3f2f2',
  page: '#e4e2e2',
  text: '#201e1d',
  accent: '#ec3013',
  accent100: '#fff2ef',
  accent700: '#ae1800',
  n300: '#d7d3d3',
  n700: '#605d5d',
  /** --color-divider: 40% text over bg, drawn as a 2px rule. */
  divider: '#9f9d9d',
} as const;

const FONT = "Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const up = (s: string) => esc(s.toLocaleUpperCase('pl-PL'));

function table(inner: string, style = ''): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="border-collapse:collapse;${style}">${inner}</table>`
  );
}

/** Small uppercase label: meta lines, captions, counts. */
function label(text: string, opts: { size?: number; color?: string; weight?: number; track?: string } = {}): string {
  return (
    `<div style="font-family:${FONT};font-size:${opts.size ?? 10}px;line-height:1.35;` +
    `letter-spacing:${opts.track ?? '.16em'};text-transform:uppercase;font-weight:${opts.weight ?? 700};` +
    `color:${opts.color ?? PC.n700}">${up(text)}</div>`
  );
}

function titleHtml(entry: AfiszkaEntry, size: number, opts: { upper?: boolean; color?: string; weight?: number } = {}): string {
  const color = opts.color ?? PC.text;
  const text = opts.upper ? up(entry.title) : esc(entry.title);
  const inner = entry.url
    ? `<a href="${esc(entry.url)}" style="color:${color};text-decoration:none">${text}</a>`
    : text;
  return (
    `<div style="font-family:${FONT};font-weight:${opts.weight ?? 700};font-size:${size}px;line-height:1.12;` +
    `letter-spacing:-.01em;color:${color}">${inner}</div>`
  );
}

function body(text: string | null, size = 12, color: string = PC.text): string {
  if (!text) return '';
  return (
    `<div style="font-family:${FONT};font-size:${size}px;line-height:1.45;color:${color};margin-top:4px">` +
    `${esc(text)}</div>`
  );
}

function big(text: string, size: number, color: string = PC.text): string {
  return (
    `<div style="font-family:${FONT};font-weight:800;font-size:${size}px;line-height:.9;` +
    `letter-spacing:-.04em;color:${color};font-variant-numeric:tabular-nums">${esc(text)}</div>`
  );
}

// ─── Front page ──────────────────────────────────────────────────────────────

function masthead(issue: AfiszkaIssue): string {
  return (
    `<tr><td style="padding:${PAD}px ${PAD}px 0">` +
    table(
      `<tr>` +
        `<td valign="bottom" style="padding-bottom:8px;border-bottom:2px solid ${PC.divider};` +
          `font-family:${FONT};font-weight:800;font-size:58px;line-height:.85;letter-spacing:-.045em;color:${PC.text}">` +
          `${AFISZKA.wordmark.head}<span style="color:${PC.accent}">.</span>${AFISZKA.wordmark.tail}</td>` +
        `<td valign="bottom" align="right" style="padding-bottom:12px;border-bottom:2px solid ${PC.divider};` +
          `font-family:${FONT};font-size:10px;line-height:1.5;letter-spacing:.18em;text-transform:uppercase;` +
          `font-weight:600;color:${PC.text}">` +
          `${up(AFISZKA.edition[issue.frequency])}<br>` +
          `${issue.issueNo ? `NR ${issue.issueNo}` : up(PL.city)}<br>afisz.cc</td>` +
      `</tr>`,
    ) +
    `</td></tr>`
  );
}

function factBand(issue: AfiszkaIssue): string {
  const cells = issue.facts.map((f, i) =>
    `<td valign="top" width="25%" style="padding:9px ${i === 3 ? 0 : 10}px 9px ${i === 0 ? 0 : 10}px;` +
      (i > 0 ? `border-left:2px solid ${PC.divider};` : '') + `">` +
      label(f.label, { weight: 600, color: PC.text, size: 9 }) +
      `<div style="font-family:${FONT};font-weight:800;font-size:15px;line-height:1.15;letter-spacing:-.01em;` +
        `color:${PC.text};margin-top:2px">${esc(f.value)}</div>` +
    `</td>`).join('');
  return (
    `<tr><td style="padding:0 ${PAD}px">` +
    table(`<tr>${cells}</tr>`, `border-bottom:2px solid ${PC.divider}`) +
    `<div style="padding:8px 0 14px;font-family:${FONT};font-size:11px;letter-spacing:.14em;` +
      `text-transform:uppercase;font-weight:600;color:${PC.accent700}">${up(issue.dedication)}</div>` +
    `</td></tr>`
  );
}

function hero(issue: AfiszkaIssue, entry: AfiszkaEntry): string {
  const evening = !entry.exhibition && Number(time(entry.first).slice(0, 2)) >= 18;
  const desc = describe(entry.description, 'short', 220);
  const when = entry.exhibition ? PL.now : time(entry.first);
  return (
    `<tr><td style="padding:0 ${PAD}px">` +
    table(
      `<tr><td style="background-color:${PC.accent};padding:14px 18px 18px">` +
        table(`<tr>` +
          `<td>${label(evening ? AFISZKA.hero : AFISZKA.heroDay, { color: PC.bg, track: '.2em' })}</td>` +
          `<td align="right">${label(entry.pick ? pickReasonLabel(entry.pick) : '', { color: PC.bg, track: '.2em' })}</td>` +
        `</tr>`) +
        table(`<tr>` +
          `<td valign="top" width="1" style="padding:10px 18px 0 0;white-space:nowrap">${big(when, 60, PC.bg)}</td>` +
          `<td valign="top" style="padding-top:10px">` +
            titleHtml(entry, 30, { upper: true, color: PC.bg, weight: 800 }) +
            `<div style="margin-top:8px;padding:5px 0;border-top:2px solid ${PC.bg};border-bottom:2px solid ${PC.bg}">` +
              label(metaLine(entry), { color: PC.bg }) +
            `</div>` +
            body(desc, 13, PC.bg) +
          `</td>` +
        `</tr>`) +
      `</td></tr>`,
    ) +
    `</td></tr>`
  );
}

function listHeader(title: string, note: string, star = false): string {
  return table(
    `<tr>` +
      `<td valign="bottom" style="padding:18px 0 6px;border-bottom:2px solid ${PC.text};font-family:${FONT};` +
        `font-weight:800;font-size:18px;letter-spacing:-.02em;text-transform:uppercase;color:${PC.text}">` +
        `${up(title)}${star ? ` <span style="color:${PC.accent}">&#9733;</span>` : ''}</td>` +
      `<td valign="bottom" align="right" style="padding:18px 0 8px;border-bottom:2px solid ${PC.text}">` +
        label(note, { weight: 600, color: PC.text }) + `</td>` +
    `</tr>`,
  );
}

/** A front-page row: a big "when" column, then title, meta, description. */
function frontRow(
  issue: AfiszkaIssue, entry: AfiszkaEntry, last: boolean,
  opts: { state?: string | null; urgent?: boolean; metaColor?: string } = {},
): string {
  const when = frontWhen(issue, entry);
  const desc = describe(entry.description, 'short');
  const extra = entry.exhibition
    ? runLabel(entry, issue.now, issue.days)
    : (issue.kind === 'outlook' ? dateRun(entry.occurrences) : '');
  return table(
    `<tr>` +
      `<td valign="top" width="96" style="width:96px;padding:10px 14px 10px 0;` +
        `border-bottom:${last ? `2px solid ${PC.divider}` : `1px solid ${PC.n300}`}">` +
        big(when.big, when.big.length > 3 ? 30 : 36) +
        (when.small ? `<div style="margin-top:4px">${label(when.small, { color: PC.accent700, size: 9 })}</div>` : '') +
      `</td>` +
      `<td valign="top" style="padding:10px 0;border-bottom:${last ? `2px solid ${PC.divider}` : `1px solid ${PC.n300}`}">` +
        (opts.state ? label(opts.state, { color: opts.urgent ? PC.accent : PC.text, size: 9 }) : '') +
        titleHtml(entry, 16) +
        `<div style="margin-top:3px">${label(metaLine(entry), { color: opts.metaColor ?? PC.accent700 })}</div>` +
        (extra ? body(extra, 11, PC.n700) : '') +
        body(desc, 12) +
      `</td>` +
    `</tr>`,
  );
}

function frontList(title: string, note: string, rows: string[], star = false): string {
  if (rows.length === 0) return '';
  return `<tr><td style="padding:0 ${PAD}px">${listHeader(title, note, star)}${rows.join('')}</td></tr>`;
}

/** Outlook: one numbered row per section, with its picks underneath. */
function contents(issue: AfiszkaIssue): string {
  if (issue.sections.length === 0) return '';
  const rows = issue.sections.map((s, i) => {
    const last = i === issue.sections.length - 1;
    const picks = s.picks.map((p) =>
      `<td valign="top" width="33%" style="padding:10px 12px 0 0">` +
        table(`<tr>` +
          `<td valign="top" width="30" style="width:30px">${big(p.exhibition && p.pick?.kind === 'opening' ? dayNumber(p.pick.at) : dayNumber(p.first), 20)}</td>` +
          `<td valign="top">` +
            titleHtml(p, 13) +
            `<div style="margin-top:3px">${label(
              [weekday(p.first), p.venue, p.exhibition ? '' : time(p.first)].filter(Boolean).join(' · '),
              { size: 9 },
            )}</div>` +
          `</td>` +
        `</tr>`) +
      `</td>`);
    const grid: string[] = [];
    for (let k = 0; k < picks.length; k += 3) {
      const row = picks.slice(k, k + 3);
      while (row.length < 3) row.push('<td width="33%"></td>');
      grid.push(`<tr>${row.join('')}</tr>`);
    }
    return (
      `<tr><td style="padding:12px 0 14px;border-bottom:${last ? `2px solid ${PC.divider}` : `1px solid ${PC.n300}`}">` +
        table(`<tr>` +
          `<td valign="baseline" width="34" style="width:34px;font-family:${FONT};font-weight:800;font-size:14px;color:${PC.accent}">` +
            `${String(i + 1).padStart(2, '0')}</td>` +
          `<td valign="baseline" style="font-family:${FONT};font-weight:800;font-size:28px;line-height:.95;` +
            `letter-spacing:-.03em;text-transform:uppercase;color:${PC.text}">${up(s.label)}</td>` +
          `<td valign="baseline" align="right">${label(s.reason, { color: PC.accent700 })}</td>` +
        `</tr>`) +
        (grid.length ? `<div style="padding-left:34px">${table(grid.join(''))}</div>` : '') +
      `</td></tr>`
    );
  });
  return (
    `<tr><td style="padding:0 ${PAD}px">` +
    table(rows.join(''), `border-top:2px solid ${PC.text}`) +
    `</td></tr>`
  );
}

function closingSoon(issue: AfiszkaIssue): string {
  if (issue.closingSoon.length === 0) return '';
  const cells = issue.closingSoon.map((e, i) =>
    `<td valign="top" width="33%" style="padding:0 12px;${i > 0 ? `border-left:2px solid ${PC.bg};` : 'padding-left:0;'}">` +
      big(dayNumber(e.run!.closes!), 52, PC.bg) +
      `<div style="margin-top:4px">${label(`${monthAbbr(e.run!.closes!)} · ${AFISZKA.lastDay}`, { color: PC.bg, size: 9 })}</div>` +
      `<div style="margin-top:10px">${titleHtml(e, 16, { upper: true, color: PC.bg, weight: 800 })}</div>` +
      `<div style="margin-top:4px">${label(e.venue, { color: PC.bg, size: 9 })}</div>` +
      body(describe(e.description, 'short', 120), 11, PC.bg) +
    `</td>`).join('');
  const pad = Array.from({ length: 3 - issue.closingSoon.length }, () => '<td width="33%"></td>').join('');
  return (
    `<tr><td style="padding:18px ${PAD}px 0">` +
    table(
      `<tr><td style="background-color:${PC.accent};padding:16px 20px 18px">` +
        label(AFISZKA.closingSoon, { color: PC.bg, track: '.2em', size: 11 }) +
        `<div style="height:12px;line-height:12px;font-size:0">&nbsp;</div>` +
        table(`<tr>${cells}${pad}</tr>`) +
      `</td></tr>`,
    ) +
    `</td></tr>`
  );
}

function festivals(issue: AfiszkaIssue): string {
  if (issue.festivals.length === 0) return '';
  const rows = issue.festivals.map((f, i) =>
    `<tr><td style="padding:8px 0;border-bottom:${i === issue.festivals.length - 1 ? `2px solid ${PC.divider}` : `1px solid ${PC.n300}`}">` +
      `<span style="font-family:${FONT};font-weight:700;font-size:15px;color:${PC.text}">${esc(f.name)}</span>` +
      `<span style="font-family:${FONT};font-weight:700;font-size:10px;letter-spacing:.16em;color:${PC.accent700}">` +
        `&nbsp;&nbsp;${esc(festivalSpan(f))}</span>` +
    `</td></tr>`).join('');
  return `<tr><td style="padding:0 ${PAD}px">${listHeader(AFISZKA.festivals, '')}${table(rows)}</td></tr>`;
}

// ─── Listing ─────────────────────────────────────────────────────────────────

function sectionHeader(section: AfiszkaSection): string {
  return table(
    `<tr>` +
      `<td valign="bottom" style="padding:34px 0 8px;border-bottom:2px solid ${PC.divider};font-family:${FONT};` +
        `font-weight:800;font-size:44px;line-height:.85;letter-spacing:-.04em;text-transform:uppercase;color:${PC.text}">` +
        `${up(section.label)}</td>` +
      `<td valign="bottom" align="right" style="padding:34px 0 10px;border-bottom:2px solid ${PC.divider}">` +
        label(section.count, { weight: 600, color: PC.text }) +
        (section.span ? label(section.span, { weight: 600, color: PC.text }) : '') +
      `</td>` +
    `</tr>`,
  );
}

/** The one-line stand-in for an entry printed in full on the front page. */
function refLine(lead: string, entry: AfiszkaEntry): string {
  return (
    `<div style="font-family:${FONT};font-size:12px;line-height:1.4;color:${PC.text}">` +
      (lead ? `<b style="font-variant-numeric:tabular-nums">${esc(lead)}</b>&nbsp; ` : '') +
      `<b>${esc(entry.title)}</b>&nbsp; ` +
      `<span style="color:${PC.accent700};font-weight:700">${esc(AFISZKA.refEmail)}</span>` +
    `</div>`
  );
}

/** A grid cell: title, venue (or category), description. */
function cell(issue: AfiszkaIssue, entry: AfiszkaEntry, section: AfiszkaSection, opts: { first: boolean; showTime?: boolean }): string {
  const border = opts.first ? '' : `border-left:1px solid ${PC.n300};`;
  if (isReferenced(issue, entry)) {
    return `<td valign="top" style="padding:0 10px;${border}">${refLine(opts.showTime ? time(entry.first) : '', entry)}</td>`;
  }
  const when = entryWhen(entry, issue.now, issue.days, !!opts.showTime);
  return (
    `<td valign="top" style="padding:0 10px;${border}">` +
      (entry.pick ? label(pickReasonLabel(entry.pick), { color: PC.accent, size: 9 }) : '') +
      titleHtml(entry, 14) +
      `<div style="margin:4px 0 2px">${label([entry.venue, when].filter(Boolean).join(' · '), { size: 9 })}</div>` +
      body(describe(entry.description, section.detail), 11) +
    `</td>`
  );
}

function grid(cells: string[], cols: number): string {
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += cols) {
    const row = cells.slice(i, i + cols);
    const width = Math.floor(100 / cols);
    rows.push(`<tr>${row.map((c) => c.replace('<td ', `<td width="${width}%" `)).join('')}` +
      `${Array.from({ length: cols - row.length }, () => `<td width="${width}%"></td>`).join('')}</tr>`);
    if (i + cols < cells.length) rows.push(`<tr><td colspan="${cols}" style="height:12px;font-size:0;line-height:0">&nbsp;</td></tr>`);
  }
  return table(rows.join(''), 'table-layout:fixed');
}

function block(issue: AfiszkaIssue, section: AfiszkaSection, b: AfiszkaBlock): string {
  if (b.kind === 'bands') {
    return b.bands.map((band) =>
      table(`<tr>` +
        `<td valign="top" width="86" style="width:86px;padding:11px 8px 11px 0;border-bottom:1px solid ${PC.n300}">` +
          big(band.time, 26) +
          `<div style="margin-top:5px">${label(band.label, { color: PC.accent700, size: 9 })}</div>` +
        `</td>` +
        `<td valign="top" style="padding:11px 0;border-bottom:1px solid ${PC.n300}">` +
          grid(band.cells.map((e, i) => cell(issue, e, section, { first: i === 0 })), 3) +
        `</td>` +
      `</tr>`)).join('');
  }
  if (b.kind === 'parts') {
    return b.parts.map((part) =>
      `<div style="padding:16px 0 8px;border-bottom:1px solid ${PC.n300};margin-bottom:10px">` +
        table(`<tr>` +
          `<td style="font-family:${FONT};font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:-.01em;color:${PC.text}">` +
            `${up(part.label)}${part.range ? ` <span style="font-weight:600;font-size:11px;letter-spacing:.12em;color:${PC.n700}">${esc(part.range)}</span>` : ''}</td>` +
          `<td align="right">${label(String(part.cells.length), { color: PC.accent })}</td>` +
        `</tr>`) +
      `</div>` +
      grid(part.cells.map((e, i) => cell(issue, e, section, { first: i % (part.allDay ? 2 : 3) === 0, showTime: !part.allDay })), part.allDay ? 2 : 3)).join('');
  }
  if (b.kind === 'venues') {
    return b.venues.map((v) =>
      `<div style="padding:16px 0 8px;border-bottom:1px solid ${PC.n300};margin-bottom:10px">` +
        table(`<tr>` +
          `<td style="font-family:${FONT};font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:-.01em;color:${PC.text}">` +
            `${up(v.name)}</td>` +
          `<td align="right">${label(String(v.entries.length), { color: PC.accent })}</td>` +
        `</tr>`) +
      `</div>` +
      // The venue is the heading; repeating it in every cell is noise (§2.2).
      grid(v.entries.map((e, i) => cell(issue, { ...e, venue: '' }, section, { first: i % 3 === 0, showTime: true })), 3)).join('');
  }
  if (b.kind === 'weeks') {
    return b.weeks.map((week) =>
      `<div style="padding:18px 0 6px;border-bottom:2px solid ${PC.text};font-family:${FONT};font-weight:800;` +
        `font-size:16px;text-transform:uppercase;letter-spacing:-.01em;color:${PC.text}">` +
        `${up(week.label)} <span style="color:${PC.accent}">${esc(week.span)}</span></div>` +
      week.entries.map((e) => weekRow(issue, section, e)).join('')).join('');
  }
  // Timeline: a label column, then a bar over the day grid.
  const n = b.days.length;
  const head = b.days.map((d) =>
    `<td align="center" style="font-family:${FONT};font-size:8px;font-weight:700;color:${PC.n700};padding-bottom:3px">` +
    `${esc(dayNumber(d))}</td>`).join('');
  const rows = b.rows.map((e) => {
    if (isReferenced(issue, e)) {
      return `<tr><td colspan="${n + 1}" style="padding:8px 0;border-bottom:1px solid ${PC.n300}">${refLine('', e)}</td></tr>`;
    }
    const { from, to } = barSpan(e, b.days);
    const bar = b.days.map((_, i) =>
      `<td style="height:4px;line-height:4px;font-size:0;${i >= from && i <= to ? `background-color:${PC.accent};` : ''}">&nbsp;</td>`).join('');
    return (
      `<tr>` +
        `<td valign="top" width="170" style="width:170px;padding:10px 10px 4px 0">` +
          titleHtml(e, 13) + `<div style="margin-top:3px">${label(e.venue, { size: 9 })}</div>` +
        `</td>` +
        `<td colspan="${n}" valign="top" style="padding:14px 0 4px">` +
          table(`<tr>${bar}</tr>`, 'table-layout:fixed') +
          `<div style="margin-top:4px">${label(runLabel(e, issue.now, n), { color: PC.accent700, size: 9 })}</div>` +
        `</td>` +
      `</tr>` +
      `<tr><td colspan="${n + 1}" style="padding:0 0 10px;border-bottom:1px solid ${PC.n300}">` +
        body(describe(e.description, section.detail), 11) +
      `</td></tr>`
    );
  }).join('');
  return (
    `<div style="padding:18px 0 6px;border-bottom:2px solid ${PC.text};font-family:${FONT};font-weight:800;` +
      `font-size:16px;text-transform:uppercase;color:${PC.text}">${up(AFISZKA.timeline)}</div>` +
    table(`<tr><td width="170"></td>${head}</tr>${rows}`, 'table-layout:fixed;margin-top:6px')
  );
}

/** An Outlook row: a date column, then title, venue, the date run, a tag. */
function weekRow(issue: AfiszkaIssue, section: AfiszkaSection, e: AfiszkaEntry): string {
  const dateCol =
    `<td valign="top" width="64" style="width:64px;padding:10px 12px 10px 0;border-bottom:1px solid ${PC.n300}">` +
      big(dayNumber(e.first), 28) +
      `<div style="margin-top:4px">${label(`${weekday(e.first)} · ${monthAbbr(e.first)}`, { color: PC.accent700, size: 9 })}</div>` +
    `</td>`;
  if (isReferenced(issue, e)) {
    return table(`<tr>${dateCol}<td valign="top" style="padding:12px 0;border-bottom:1px solid ${PC.n300}">` +
      refLine(time(e.first), e) + `</td></tr>`);
  }
  return table(
    `<tr>${dateCol}` +
      `<td valign="top" style="padding:10px 0;border-bottom:1px solid ${PC.n300}">` +
        titleHtml(e, 15) +
        `<div style="margin-top:3px">${label(e.venue, { size: 9 })}</div>` +
        body(dateRun(e.occurrences), 11, PC.n700) +
        body(describe(e.description, section.detail), 12) +
      `</td>` +
      `<td valign="top" align="right" width="80" style="width:80px;padding:12px 0;border-bottom:1px solid ${PC.n300}">` +
        (e.pick ? `<span style="display:inline-block;background-color:${PC.accent100};padding:2px 6px">` +
          label(pickReasonLabel(e.pick), { color: PC.accent700, size: 9 }) + `</span>` : '') +
      `</td>` +
    `</tr>`,
  );
}

function listing(issue: AfiszkaIssue): string {
  return issue.sections.map((s) =>
    `<tr><td style="padding:0 ${PAD}px">${sectionHeader(s)}${s.blocks.map((b) => block(issue, s, b)).join('')}</td></tr>`,
  ).join('');
}

function footer(): string {
  const manage = `${env.APP_URL}/my?tab=newsletter`;
  const open = `${env.APP_URL}/my`;
  const link = `color:${PC.accent700};text-decoration:none`;
  return (
    `<tr><td style="padding:28px ${PAD}px ${PAD}px">` +
      `<div style="border-top:2px solid ${PC.divider};padding-top:12px;font-family:${FONT};font-size:10px;` +
        `line-height:1.8;letter-spacing:.18em;text-transform:uppercase;font-weight:600;color:${PC.n700}">` +
        `<a href="${esc(manage)}" style="${link}">${up(PL.settings)}</a> &middot; ` +
        `<a href="${esc(manage)}" style="${link}">${up(PL.unsubscribe)}</a> &middot; ` +
        `<a href="${esc(open)}" style="${link}">${up(PL.open)}</a>` +
        `<div>${up(PL.sender)}</div>` +
      `</div>` +
    `</td></tr>`
  );
}

export function renderAfiszkaHtml(content: AfiszkaContent): string {
  const issue = buildAfiszkaIssue(content);
  const savedRows = issue.saved.map((s, i) =>
    frontRow(issue, s.entry, i === issue.saved.length - 1, { state: s.state, urgent: s.urgent, metaColor: PC.n700 }));
  const front = issue.kind === 'daily'
    ? (issue.hero ? hero(issue, issue.hero) : '') +
      frontList(AFISZKA.morePicks, AFISZKA.morePicksNote,
        issue.morePicks.map((e, i) => frontRow(issue, e, i === issue.morePicks.length - 1, {
          state: e.pick ? pickReasonLabel(e.pick) : null, urgent: true,
        })))
    : contents(issue) + closingSoon(issue);
  const wantNote = issue.kind === 'daily' ? AFISZKA.wantToGoNote.daily : AFISZKA.wantToGoNote.other;
  const nothing = issue.empty
    ? `<tr><td style="padding:16px ${PAD}px;font-family:${FONT};font-size:13px;color:${PC.n700}">${esc(AFISZKA.nothing)}</td></tr>`
    : '';

  return (
    `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ` +
      `"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">` +
    `<html xmlns="http://www.w3.org/1999/xhtml"><head>` +
      `<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />` +
      `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
      `<meta name="color-scheme" content="light" />` +
      `<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&amp;display=swap" rel="stylesheet" />` +
      `<title>AFISZ.KA</title>` +
    `</head>` +
    `<body style="margin:0;padding:0;background-color:${PC.page};-webkit-text-size-adjust:100%">` +
      table(
        `<tr><td align="center" style="padding:0">` +
          `<table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" ` +
            `style="border-collapse:collapse;width:${WIDTH}px;max-width:${WIDTH}px;background-color:${PC.bg}">` +
            masthead(issue) +
            factBand(issue) +
            front +
            frontList(AFISZKA.wantToGo, wantNote, savedRows, true) +
            festivals(issue) +
            nothing +
            listing(issue) +
            footer() +
          `</table>` +
        `</td></tr>`,
        `background-color:${PC.page}`,
      ) +
    `</body></html>`
  );
}
