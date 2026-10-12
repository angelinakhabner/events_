import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flightHtml, hasSynopsisRule, MAX_SYNOPSIS_CHARS, paragraphs, venueSynopsis } from './synopsis.js';

const fixture = (name: string) => readFileSync(join(process.cwd(), 'test/fixtures', name), 'utf8');

/**
 * Real show pages, captured from the live sites (venue-diagnose, 2026-10-05).
 * For each: where the synopsis starts, and what the page around it says that
 * must not end up in it — the hours, prices, rooms and slogans that were
 * reaching the site as descriptions.
 */
const PAGES: Array<{ url: string; file: string; starts: string; excludes: string[] }> = [
  {
    url: 'https://powszechny.com/pl/spektakle/trojanki',
    file: 'powszechny.com-pl-spektakle-trojanki.html',
    starts: 'Spektakl „Trojanki” to emocjonalny i olśniewający wizualnie traktat',
    // The page's meta description, and the accessibility block that follows
    // the synopsis in the same markup.
    excludes: ['Twoje źródło różnorodnych', 'dostępność', 'Wczytywanie'],
  },
  {
    url: 'https://powszechny.com/pl/spektakle/lisa',
    file: 'powszechny.com-pl-spektakle-lisa.html',
    starts: '„Najniebezpieczniejszym wytworem każdego społeczeństwa',
    excludes: ['­', 'dostępność'],
  },
  {
    url: 'https://trwarszawa.pl/program/laguna/',
    file: 'trwarszawa.pl-program-laguna.html',
    starts: 'Po co wymyślać horrory, skoro wszędzie pełno strachu?',
    excludes: ['KUP BILET', 'Bilet normalny', '19:00-20:10'],
  },
  {
    url: 'https://trwarszawa.pl/program/power-play/',
    file: 'trwarszawa.pl-program-power-play.html',
    starts: 'Jeśli mamy szczęście, rodzimy się królowymi lub królami',
    excludes: ['KUP BILET', 'Bilet normalny'],
  },
  {
    url: 'https://teatrstudio.pl/pl/teatr/wydarzenia/serce_ze_szkla_musical_zen/',
    file: 'teatrstudio.pl-pl-teatr-wydarzenia-serce_ze_szkla_musical_zen.html',
    starts: '„Serce ze szkła. Musical zen” na motywach „Królowej Śniegu”',
    excludes: ['190 ZŁ', 'czas trwania', 'Usytuowany w budynku PKiN'],
  },
  {
    url: 'https://nowyteatr.org/pl/kalendarz/europa',
    file: 'nowyteatr.org-pl-kalendarz-europa.html',
    starts: 'Cisza. Przemilczane zbrodnie.',
    excludes: ['godz. 18:00', 'Czas trwania', 'touch tour'],
  },
  {
    url: 'https://nowyteatr.org/pl/kalendarz/kofman-podwojne-wiazanie',
    file: 'nowyteatr.org-pl-kalendarz-kofman-podwojne-wiazanie.html',
    starts: 'Sarah Kofman – francuska filozofka',
    excludes: ['Czas trwania', 'Najbliższe spektakle'],
  },
  {
    url: 'https://zacheta.art.pl/pl/kalendarz/twoj-telefon-twoje-zasady',
    file: 'zacheta.art.pl-pl-kalendarz-twoj-telefon-twoje-zasady.html',
    starts: 'Jak dorastamy w świecie, w którym ekran telefonu',
    excludes: ['sala kinowa', 'wstęp wolny', 'Partnerami wydarzenia', 'Dziękujemy za rejestrację'],
  },
  {
    url: 'https://zacheta.art.pl/pl/wystawy/dojrzewanie',
    file: 'zacheta.art.pl-pl-wystawy-dojrzewanie.html',
    starts: 'Dojrzewanie to uniwersalna opowieść o kruchości',
    excludes: ['Godziny otwarcia', 'kuratorki:', 'laserów', 'British Council'],
  },
  {
    url: 'https://artmuseum.pl/en/events/fatherland-1',
    file: 'artmuseum.pl-en-events-fatherland-1.html',
    starts: 'Fatherland is the latest, long-awaited film by Oscar® winner Paweł Pawlikowski',
    excludes: ['Buy ticket', 'Running time', 'Museum is closed'],
  },
  {
    url: 'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/9144,wydarzenie.html',
    file: 'mnw.art.pl-wydarzenia-kalendarz-wydarzen-9144-wydarzenie.html.html',
    starts: 'Sztukę poznajemy poprzez jej kontemplację i doświadczanie.',
    excludes: ['godz. 10.30', 'Termin:', 'Pozostałe wydarzenia miesiąca', 'pliki cookie'],
  },
  {
    url: 'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/9231,wydarzenie.html',
    file: 'mnw.art.pl-wydarzenia-kalendarz-wydarzen-9231-wydarzenie.html.html',
    starts: 'zajęcia dla dorosłych w trakcie nauki języka polskiego',
    excludes: ['godz. 18.00', 'Termin:', 'Czas trwania', 'Muzeum dostępne', 'CYKL'],
  },
  {
    url: 'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/2663,wydarzenie.html',
    file: 'krolikarnia.mnw.art.pl-wydarzenia-kalendarz-wydarzen-2663-wydarzenie.html.html',
    starts: 'zwiedzanie wystawy Rzeźba na meblościankę',
    excludes: ['godz. 11.00', 'Termin:', 'bilety 15 i 10 zł', 'Miejsce:'],
  },
  {
    url: 'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/2681,wydarzenie.html',
    file: 'krolikarnia.mnw.art.pl-wydarzenia-kalendarz-wydarzen-2681-wydarzenie.html.html',
    starts: 'Sędziwe drzewa i krzewy są ostoją dzikiego życia',
    excludes: ['godz. 11.30', 'Pozostałe wydarzenia miesiąca'],
  },
  {
    url: 'https://www.postermuseum.pl/wydarzenia/kalendarz-wydarzen/1810,wydarzenie.html',
    file: 'www.postermuseum.pl-wydarzenia-kalendarz-wydarzen-1810-wydarzenie.html.html',
    starts: 'zwiedzanie wystawy z jej współkuratorką',
    // Here "Termin:" runs on inside the synopsis' own paragraph.
    excludes: ['godz. 11.00 i 13.00', 'Termin:', 'bilety w cenie', 'Iwanicka-Dzierżawska – historyczka'],
  },
  {
    url: 'https://u-jazdowski.pl/en/kino/repertuar/the-virgin-suicides',
    file: 'u-jazdowski.pl-en-kino-repertuar-the-virgin-suicides.html',
    starts: 'Sofia Coppola’s legendary directorial debut',
    excludes: ['Back to: Repertoire', "USA 1999, 96'"],
  },
];

describe('venueSynopsis on captured show pages', () => {
  for (const page of PAGES) {
    it(new URL(page.url).hostname + new URL(page.url).pathname, () => {
      const text = venueSynopsis(fixture(page.file), page.url);
      expect(text).not.toBeNull();
      expect(text!.startsWith(page.starts)).toBe(true);
      expect(text!.length).toBeLessThanOrEqual(MAX_SYNOPSIS_CHARS);
      for (const bad of page.excludes) expect(text).not.toContain(bad);
    });
  }

  it('finds nothing on a page from a site without a rule', () => {
    const html = fixture('trwarszawa.pl-program-laguna.html');
    expect(venueSynopsis(html, 'https://example.org/show')).toBeNull();
  });

  it('finds nothing when the rule matches a page of another shape', () => {
    // TR's listing, not a show page: no synopsis block, so no synopsis.
    const html = fixture('trwarszawa.pl-repertuar.html');
    expect(venueSynopsis(html, 'https://trwarszawa.pl/repertuar/')).toBeNull();
  });
});

describe('hasSynopsisRule', () => {
  it('matches by hostname, with or without www.', () => {
    expect(hasSynopsisRule('https://www.postermuseum.pl/wydarzenia/1,wydarzenie.html')).toBe(true);
    expect(hasSynopsisRule('https://trwarszawa.pl/program/laguna/')).toBe(true);
    expect(hasSynopsisRule('https://kinomuranow.pl/film/x')).toBe(false);
  });

  it('is false for a show key that is not a URL', () => {
    expect(hasSynopsisRule('title:trojanki')).toBe(false);
  });
});

describe('paragraphs', () => {
  it('drops logistics paragraphs and keeps the rest in order', () => {
    const html = `<div class="t">
      <p>godz. 18.00</p>
      <p>Spektakl o pamięci i zapominaniu, oparty na wspomnieniach mieszkańców Muranowa.</p>
      <p>Bilety: 50 zł</p>
      <p>Scena: Duża</p>
      <p>Reżyseria i tekst powstały we współpracy z zespołem aktorskim teatru.</p>
    </div>`;
    expect(paragraphs(html, ['.t'])).toBe(
      'Spektakl o pamięci i zapominaniu, oparty na wspomnieniach mieszkańców Muranowa.\n\n' +
        'Reżyseria i tekst powstały we współpracy z zespołem aktorskim teatru.',
    );
  });

  it('cuts a paragraph that runs on into the stop marker, and stops there', () => {
    const html = `<div class="t">
      <p>Opowieść o plakacie jako historii przemian społecznych i politycznych. Termin: niedziela, godz. 11.00</p>
      <p>Bio prowadzącej, które nie jest już o wydarzeniu.</p>
    </div>`;
    expect(paragraphs(html, ['.t'], { stopAt: /\btermin\s*:/i })).toBe(
      'Opowieść o plakacie jako historii przemian społecznych i politycznych.',
    );
  });

  it('skips a matching block too short to be a synopsis for the next one', () => {
    const html = `<div class="t"><p></p></div>
      <div class="t"><p>Druga kolumna niesie właściwy opis spektaklu, dość długi, by się liczyć.</p></div>`;
    expect(paragraphs(html, ['.t'])).toBe('Druga kolumna niesie właściwy opis spektaklu, dość długi, by się liczyć.');
  });
});

describe('flightHtml', () => {
  const page = (chunks: string[]) =>
    chunks.map((c) => `<script>self.__next_f.push([1,${JSON.stringify(c)}])</script>`).join('');

  it('reads an inline block after the marker', () => {
    const html = page([
      '5:["$","div",null,{"className":"content","dangerouslySetInnerHTML":{"__html":"<p>Inline</p>"}}]\n',
    ]);
    expect(flightHtml(html, '"className":"content"')).toBe('<p>Inline</p>');
  });

  it('resolves a text-row reference by its UTF-8 byte length, across chunks', () => {
    const body = '<p>Zażółć gęślą jaźń</p>';
    const len = Buffer.byteLength(body, 'utf8').toString(16);
    const html = page([
      `25:T${len},${body.slice(0, 8)}`,
      `${body.slice(8)}26:["$","p",null,{}]\n`,
      '7:["$","div",null,{"className":"content","dangerouslySetInnerHTML":{"__html":"$25"}}]\n',
    ]);
    expect(flightHtml(html, '"className":"content"')).toBe(body);
  });

  it('is null when the marker is absent', () => {
    expect(flightHtml(page(['1:["$","div",null,{}]\n']), '"className":"content"')).toBeNull();
  });
});
