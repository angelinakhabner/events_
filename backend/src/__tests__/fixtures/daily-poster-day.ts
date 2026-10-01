import type { Event } from '@afisz/shared';
import type { BriefSection } from '../../services/newsletter-render.js';

/**
 * The sample day the "AFISZ.KA Daily" design was drawn from: Warsaw, Friday
 * 4 September 2026, 31 events across 8 places. Kept as a fixture so the
 * poster's tests and a local render can both be checked against the mock.
 */

const VENUES: Record<string, string> = {
  muranow: 'Kino Muranów',
  kinoteka: 'Kinoteka',
  iluzjon: 'Kino Iluzjon',
  plakat: 'Muzeum Plakatu w Wilanowie',
  krolikarnia: 'Królikarnia',
  msn: 'Muzeum Sztuki Nowoczesnej',
  filharmonia: 'Filharmonia Narodowa',
  jassmine: 'Jassmine',
};

/** The issue goes out at 08:00 Warsaw (06:00 UTC) on the day it covers. */
export const SAMPLE_NOW = new Date('2026-09-04T06:00:00.000Z');

let seq = 0;
function ev(
  category: Event['category'],
  venue: keyof typeof VENUES,
  at: string | null,
  title: string,
  description: string | null = null,
  over: Partial<Event> = {},
): Event {
  seq += 1;
  // Warsaw is UTC+2 in September.
  const startsAt = at
    ? new Date(`2026-09-04T${at}:00+02:00`).toISOString()
    : new Date('2026-09-04T00:00:00+02:00').toISOString();
  return {
    id: `e${String(seq).padStart(2, '0')}`,
    venueId: venue,
    venue: { id: venue, name: VENUES[venue]!, category, city: 'Warszawa', country: 'PL' },
    title,
    description,
    startsAt,
    endsAt: at ? null : '2026-10-31T00:00:00.000Z',
    kind: at ? 'timed' : 'exhibition',
    category,
    language: 'pl',
    director: null,
    cast: [],
    durationMinutes: null,
    priceMin: null,
    priceMax: null,
    sourceUrl: `https://example.org/${venue}/${seq}`,
    sourceId: null,
    scrapedAt: '2026-09-03T00:00:00.000Z',
    ...over,
  };
}

const PARASITE = '„Parasite” to pełen dzikiego humoru i nieoczekiwanych zwrotów akcji thriller o ludziach, którzy nigdy nie mieli się spotkać – biednych i bogatych, tych naprawdę uprzywilejowanych i tych zepchniętych…';
const REQUIEM = '„Requiem dla snu” to drugi pełnometrażowy film Darrena Aronofsky’ego, na podstawie powieści legendarnego amerykańskiego pisarza, Huberta Selby’ego Jr.';
const TONY = 'Młody Anthony Bourdain podczas upalnego lata 1976 roku odkrywa swoją pasję, powołanie i to, kim tak naprawdę jest.';

export const CINEMA: Event[] = [
  ev('cinema', 'muranow', '19:00', 'Gorzkie święta', 'Pedro Almodóvar powraca w szczytowej formie z jednym ze swoich najbardziej osobistych filmów.'),
  ev('cinema', 'kinoteka', '20:00', 'Odyseja', 'To starożytna opowieść autorstwa Homera uznawana za jedno z najważniejszych dzieł literatury zachodniej.'),
  ev('cinema', 'kinoteka', '20:00', 'Zaproszenie', 'Znudzone sobą małżeństwo zaprasza na kolację parę wyzwolonych sąsiadów.'),
  ev('cinema', 'muranow', '20:15', 'Requiem dla snu', REQUIEM),
  ev('cinema', 'muranow', '20:15', 'Nowa Fala', 'Najnowszy film Richarda Linklatera „Nowa Fala” (2025) to energetyczna podróż do Paryża końca lat 50., opowiadająca historię powstawania „Do utraty tchu” Jeana-Luca Godarda i narodzin francuskiej…'),
  ev('cinema', 'kinoteka', '20:15', 'Tony', TONY),
  ev('cinema', 'muranow', '20:30', 'Tony', TONY),
  ev('cinema', 'kinoteka', '20:30', 'Gorzkie święta | Nowy film Pedro Almodóvara', 'Po śmierci matki Elza rzuca się w wir pracy, nie pozwalając sobie na przeżycie żałoby.'),
  ev('cinema', 'kinoteka', '20:30', 'Vivaldi i ja', 'Cecilia, wychowana w sierocińcu utalentowana skrzypaczka, spotyka Antonia Vivaldiego, który zostaje jej...'),
  ev('cinema', 'kinoteka', '20:30', 'LOT Kino Letnie: W Stronę Zachodzącego Słońca', 'Wydarzenie niebiletowane | LOT Kino Letnie: W Stronę Zachodzącego Słońca to projekt stworzony w 2023 r.', { priceMin: 0, priceMax: 0 }),
  ev('cinema', 'iluzjon', '20:30', 'Absolwent', 'Amerykański film z 1967 roku, pokaz w sali Mała Czarna.'),
  ev('cinema', 'kinoteka', '20:45', 'Młodsza siostra', 'Subtelny portret młodej dziewczyny, która wchodzi w dorosłe życie i kształtuje swoją tożsamość.'),
  ev('cinema', 'muranow', '22:15', 'Parasite', PARASITE),
  ev('cinema', 'muranow', '22:35', 'Sirât', 'Najbardziej wystrzałowy film tegorocznego festiwalu w Cannes, gdzie zasłużenie otrzymał Nagrodę Jury.'),
  ev('cinema', 'muranow', '22:35', 'Requiem dla snu', REQUIEM),
];

export const EXHIBITION: Event[] = [
  ev('exhibition', 'plakat', null, 'Plakat polski. Kolekcja / odsłona 2.'),
  ev('exhibition', 'krolikarnia', null, 'Rzeźba na meblościankę'),
  ev('exhibition', 'msn', '10:00', 'Birdwatching walk and guided tour of the Zofia and Oskar Hansen House'),
  ev('exhibition', 'krolikarnia', '11:00', 'Działania performatywne / Rzeźby w ruch!'),
  ev('exhibition', 'msn', '11:00', 'Warsaw Under Construction 18: A Bicycle Tour Through Urzecze Park', 'Wycieczka rowerowa zaprojektowana przez Macieja Łepkowskiego przez tereny dawnego mikroregionu Urzecze — unikalnego krajobrazu wzdłuż Wisły — eksplorująca dziedzictwo kulturowe i przyrodnicze tych…'),
  ev('exhibition', 'msn', '12:00', 'Warsaw Under Construction 18: FLOW. A River Trip in the Footsteps of Urzecze', 'Rejs rzeką Wisłą na pokładzie Galara Solnego, podczas którego uczestnicy poznają historię, ekosystem i współczesny charakter mikroregionu Urzecze, prowadzony przez artystki Agnieszkę Brzeżańską i Ewę…'),
  ev('exhibition', 'msn', '12:30', 'Guided tours of current exhibitions (Polish)', 'Oprowadzanie po wystawach „Jesteś w sercu zmian”.'),
  ev('exhibition', 'msn', '13:00', 'The Little Sister', '„The Little Sister” to francuski film w reżyserii Hafsi Herzi opowiadający o siedemnastoletniej Fatimie, córce francusko-algierskiej rodziny z przedmieść Paryża, która balansuje między lojalnością…'),
  ev('exhibition', 'krolikarnia', '13:00', 'Działania performatywne / Rzeźba nas obchodzi'),
  ev('exhibition', 'msn', '14:00', 'Guided tour of Zofia and Oskar Hansen’s home', 'Oprowadzanie po domu Zofii i Oskara Hansenów w Szuminie, modernistycznym domu-pracowni nad Bugiem.'),
  ev('exhibition', 'krolikarnia', '15:00', 'Warsztaty dorosłych i młodzieży / Bliższe spotkanie z porcelaną: udekoruj własną rzeźbę na meblościankę'),
  ev('exhibition', 'msn', '15:30', 'Teenage Sex and Death at Camp Miasma', 'Film de Jane Schoenbrun dans lequel une jeune réalisatrice (Hannah Einbinder) chargée de tourner le remake d’une série d’horreur culte des années 80-90 rend visite à l’actrice légendaire (Gillian…'),
  ev('exhibition', 'msn', '18:00', 'Hangashore', '„Hangashore” Justina Oakey’a to powolny horror, w którym nawiedzana snami i wizjami artystka podróżuje do Nowej Fundlandii, by odnaleźć miejsce śmierci ojca, a groza kryje się pod powierzchnią…'),
  ev('exhibition', 'msn', '20:30', 'I Want Your Sex', '„I Want Your Sex” (2026) to nowy film Gregga Arakiego, w którym Elliot (Cooper Hoffman) zostaje asystentem prowokatorskiej artystki Eriki Tracy (Olivia Wilde) i staje się jej seksualną muzą — komedia…'),
];

export const MUSIC: Event[] = [
  ev('music', 'filharmonia', '19:00', '22. Festiwal „Chopin i jego Europa”', 'Narodowa Orkiestra Symfoniczna Polskiego Radia i Christian Arming oraz Tianyao Lyu.'),
  ev('music', 'jassmine', '19:00', 'Jassmine 6th Birthday: Błoto plays Detroit Techno', 'Błoto sięgnie tym razem po klasyków elektronicznej strony Motor City.'),
];

export const SAMPLE_SECTIONS: BriefSection[] = [
  { category: 'cinema', windowDays: 1, detail: 'full', events: CINEMA },
  { category: 'exhibition', windowDays: 1, detail: 'full', events: EXHIBITION },
  { category: 'music', windowDays: 1, detail: 'full', events: MUSIC },
];

/** The mock's "Want to go": the Hansen house tour, the Chopin concert and
 *  Absolwent at Iluzjon. */
export const SAMPLE_SAVED = [
  EXHIBITION.find((e) => e.title.startsWith('Guided tour of Zofia'))!.id,
  MUSIC[0]!.id,
  CINEMA.find((e) => e.title === 'Absolwent')!.id,
];
