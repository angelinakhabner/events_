/**
 * The copy for the public landing page (frontend/src/landing/render.ts).
 *
 * Plain data, deliberately: this module is imported by `vite.config.ts` and
 * rendered to static HTML at build time, so it must stay free of React, of
 * the DOM, and of anything that only exists in a browser.
 *
 * It is also the only place this copy lives. The page a stranger sees, the
 * `<meta name="description">` a crawler reads and the privacy policy are all
 * generated from here, so they cannot drift apart.
 *
 * `{email}` in any string is replaced by a mailto link to CONTACT_EMAIL when
 * the page is rendered. Everything else is escaped — write prose, not markup.
 */

/** The product name, as it is written everywhere outside the app chrome. */
export const NAME = 'AFISZ.KA';

/**
 * Where invite requests and privacy requests land. This is the address the
 * deployment already sends transactional mail from (see docs/RUNBOOK.md); the
 * policy below promises a human answers it, so it must be able to receive.
 */
export const CONTACT_EMAIL = 'hello@afisz.cc';

export const SITE_URL = 'https://afisz.cc';

/** Shown under the wordmark, and used as the page's `og:title` suffix. */
export const TAGLINE = 'Agregator wydarzeń kulturalnych, który składasz sam.';

/**
 * The one-paragraph answer to "what is this". Also the meta description,
 * trimmed to its first sentence and a half — see `metaDescription()`.
 */
export const DESCRIPTION = `${NAME} to agregator wydarzeń kulturalnych, który budujesz dla siebie, miejsce po miejscu. Zamiast przeglądać miejski serwis z programem i liczyć, że akurat obejmuje to, co Cię interesuje, wskazujesz ${NAME} miejsca, do których naprawdę chodzisz — kino, teatr, galerię, filharmonię, cokolwiek, co publikuje program w sieci — a ${NAME} czyta ich repertuary za Ciebie i zamienia luźne strony z programem w wydarzenia, które można filtrować. Miejsca grupujesz w nazwane listy, jedną na miasto albo na nastrój, a każda pamięta własne filtry kategorii, godziny, ceny i dnia. Możesz też oznaczać, na co chcesz iść, udostępnić tę listę osobie, z którą chcesz pójść, dodać seans prosto do kalendarza i dostawać e-mailem przegląd tego, co nadchodzi, w wybrany przez siebie poranek.`;

/** The invitation note. Not buried: it is a section of its own on the page. */
export const ACCESS_HEADING = 'Dostęp na zaproszenie';
export const ACCESS_BLOCKS: readonly string[] = [
  `${NAME} jest w zamkniętych testach. Nie ma publicznej rejestracji ani możliwości założenia konta z tej strony — aplikacja otwiera się tylko w przeglądarce, która ma działający link z zaproszeniem, a bez niego każda jej część, aż po ostatnie zapytanie o dane, pozostaje zamknięta.`,
  `Jeśli chcesz dostać zaproszenie, napisz na {email} i opowiedz krótko, w jakim mieście i jakie miejsca chcesz obserwować. Zaproszenia wysyłamy w małych partiach, dopóki aplikacja jest w budowie.`,
];

export const CONTACT_HEADING = 'Kontakt';
export const CONTACT_BLOCKS: readonly string[] = [
  `Zaproszenia, pytania, miejsce, którego program jest źle odczytywany, albo cokolwiek w sprawie poniższej polityki: {email}.`,
];

/**
 * The controller's registered identity (GOI-95).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * FILL THESE IN BEFORE THE SITE OPENS TO THE PUBLIC.
 *
 * Polish law names them specifically, and a policy without them is not merely
 * thin — it is non-compliant. Art. 13(1)(a) RODO requires the controller's
 * identity and contact details in the privacy notice, and art. 8(1)(1) of the
 * ustawa o świadczeniu usług drogą elektroniczną requires the service
 * provider's identifying details in the regulamin. Both documents and both
 * surfaces that render them read from here, so this is the only edit needed.
 * ───────────────────────────────────────────────────────────────────────────
 */
export const OPERATOR_ENTITY = '';
/** Registered address for correspondence. */
export const OPERATOR_ADDRESS = '';

/** How the operator is named in prose while the two fields above are blank. */
export function operatorIdentity(): string {
  if (!OPERATOR_ENTITY.trim()) return `operator serwisu ${NAME}`;
  return OPERATOR_ADDRESS.trim()
    ? `${OPERATOR_ENTITY}, ${OPERATOR_ADDRESS}`
    : OPERATOR_ENTITY;
}

/**
 * Poland's data-protection authority, which art. 13(2)(d) RODO requires the
 * notice to name as the body a reader may complain to.
 *
 * `host` carries no scheme on purpose. This copy is rendered into the static
 * landing page, whose own policy promises the page fetches nothing from
 * anywhere else — and `render.test.ts` enforces that by rejecting any
 * `https://` in the markup at all, rather than trying to tell a link apart
 * from a URL merely quoted in prose. A bare host is just as useful to a reader
 * and keeps that guard as blunt as it should be.
 */
export const DPA = {
  name: 'Prezes Urzędu Ochrony Danych Osobowych',
  address: 'ul. Stawki 2, 00-193 Warszawa',
  host: 'uodo.gov.pl',
} as const;

export const POLICY_HEADING = 'Polityka prywatności';
export const POLICY_UPDATED = '29 września 2026';

export type PolicyBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: readonly string[] };

export interface PolicySection {
  heading: string;
  blocks: readonly PolicyBlock[];
}

/**
 * The policy describes what the code in this repository actually does. Each
 * claim is checkable: the collected data is the schema in
 * `backend/src/db/schema.ts`, the processors are the services in
 * `backend/src/services/`, and the "no analytics" claim is the absence of any
 * tracking script in this bundle. Changing any of those means changing this.
 *
 * Written in Polish since the whole site is: the Polish version is the one a
 * Polish reader and a Polish regulator read, so it is the one that has to be
 * exact.
 */
export const POLICY_SECTIONS: readonly PolicySection[] = [
  {
    heading: 'Kim jesteśmy',
    blocks: [
      {
        kind: 'p',
        text: `${NAME} to mały, niezależnie prowadzony projekt. Administratorem danych osobowych opisanych poniżej jest ${operatorIdentity()}, z którym można się skontaktować pod adresem {email} — to także adres właściwy we wszystkich sprawach dotyczących tej polityki. Nie wyznaczono inspektora ochrony danych, ponieważ art. 37 RODO nie wymaga tego przy przetwarzaniu tego rodzaju; powyższy adres trafia bezpośrednio do administratora.`,
      },
      {
        kind: 'p',
        text: 'Strona, którą właśnie czytasz, jest zwykłym statycznym dokumentem. Nie pobiera czcionek, skryptów, obrazów ani stylów z innych miejsc, nie ustawia plików cookie i niczego nie zapisuje w Twojej przeglądarce. Jej przeczytanie nie zostawia u nas żadnego śladu poza zwykłym logiem serwera prowadzonym przez GitHub Pages, który ją udostępnia.',
      },
    ],
  },
  {
    heading: 'Co zbiera aplikacja i po co',
    blocks: [
      {
        kind: 'p',
        text: 'Nic z poniższego nie dotyczy Cię, dopóki nie przyjmiesz zaproszenia i nie zaczniesz korzystać z aplikacji. Wszystko, co przechowuje, to rzeczy, które sam(a) wpisujesz lub o które prosisz; nie tworzymy profilu na podstawie Twojego zachowania.',
      },
      {
        kind: 'p',
        text: 'RODO wymaga, by każdy cel przetwarzania miał wskazaną podstawę prawną, więc oto one. Twoje konto, listy i wszystko, co zapisujesz, przetwarzamy na podstawie art. 6 ust. 1 lit. b — w celu wykonania umowy zawartej przez przyjęcie zaproszenia. Newsletter e-mailowy i połączony folder na Dysku Google opierają się na art. 6 ust. 1 lit. a, czyli Twojej zgodzie, którą możesz wycofać w dowolnym momencie bez wpływu na zgodność z prawem wcześniejszego przetwarzania. Identyfikator przeglądarki sprzed zalogowania i zwykłe logi serwera opierają się na art. 6 ust. 1 lit. f — prawnie uzasadnionym interesie w tym, by aplikacja działała, zanim założysz konto, oraz by serwis działał sprawnie i bez nadużyć. Nie przetwarzamy szczególnych kategorii danych (art. 9), a aplikacja nie jest skierowana do dzieci poniżej 16. roku życia.',
      },
      {
        kind: 'list',
        items: [
          'Twój adres e-mail, jeśli się logujesz. To on jest kontem — nie ma hasła. Logowanie wysyła na ten adres jednorazowy link; przechowujemy wyłącznie skrót (hash) tego linku i tylko do chwili jego użycia lub wygaśnięcia.',
          'Dodane przez Ciebie miejsca, listy, w które je grupujesz, wszelkie nazwy, kategorie i własne tagi, którymi je zastępujesz, oraz filtry zapamiętane przez każdą listę. To jest istota aplikacji.',
          'Wydarzenia oznaczone jako „Chcę iść” i każda lista, którą zdecydujesz się udostępnić. Udostępniona lista staje się widoczna dla każdego, kto ma wysłany przez Ciebie link — na tym polega udostępnianie; możesz je wyłączyć w każdej chwili.',
          'Ustawienia newslettera, jeśli go zamówisz: adres, na który trafia, imię, którym ma Cię witać, obejmowane miejsca i kategorie oraz godzina wysyłki.',
          'Losowy identyfikator w pamięci lokalnej (local storage) przeglądarki, dzięki któremu rzeczy zapisane przed zalogowaniem pozostają Twoje także potem. To losowa wartość bez własnego znaczenia, nigdy nie łączona z danymi kupionymi lub otrzymanymi skądinąd.',
          'Plik cookie z zaproszeniem, ustawiany po otwarciu linku z zaproszeniem, żeby nie trzeba było podawać go przy każdej wizycie. Zawiera wyłącznie token zaproszenia i to dzięki niemu serwis w ogóle się otwiera.',
          'Dostęp do folderu na Dysku Google — tylko jeśli sam(a) go połączysz, żeby newslettery były tam zapisywane jako pliki PDF. Połączenie przechowuje token odświeżania Google i adres połączonego konta. Rozłączenie usuwa oba.',
        ],
      },
    ],
  },
  {
    heading: 'Czego nigdy nie zbieramy',
    blocks: [
      {
        kind: 'p',
        text: 'W projekcie nie ma żadnych reklam ani technologii reklamowych. Nie ma pakietu analitycznego, pikseli śledzących, nagrywania sesji, fingerprintingu ani plików cookie podmiotów trzecich. Twoich danych nie sprzedajemy, nie wynajmujemy, nie przekazujemy brokerom danych i nie używamy do trenowania modeli uczenia maszynowego.',
      },
      {
        kind: 'p',
        text: 'Nic tutaj nie podejmuje zautomatyzowanych decyzji wywołujących skutki prawne lub w podobny sposób istotnie wpływających na osobę i nikt nie jest profilowany w rozumieniu art. 22 RODO. Aplikacja pokazuje to, co sam(a) zdecydujesz się obserwować.',
      },
    ],
  },
  {
    heading: 'Kto jeszcze ma do nich dostęp',
    blocks: [
      {
        kind: 'p',
        text: 'Działanie aplikacji wymaga kilku zewnętrznych usług. Każda widzi tylko tę część danych, której potrzebuje do swojego zadania, i żadna nie otrzymuje niczego do własnych celów:',
      },
      {
        kind: 'list',
        items: [
          'Railway hostuje serwer aplikacji i jego bazę danych Postgres, więc opisane wyżej dane fizycznie znajdują się tam.',
          'GitHub Pages udostępnia stronę, którą oglądasz, i prowadzi zwykłe logi dostępu po stronie serwera.',
          'Resend dostarcza e-maile — linki do logowania i newsletter — a więc przetwarza adres odbiorcy i treść wiadomości.',
          'Modele Claude firmy Anthropic czytają pobierane przez nas strony z programem miejsc, by zamienić je w uporządkowane wydarzenia, i piszą opisy wydarzeń. Wysyłana jest publiczna strona internetowa miejsca. Twoje konto, listy i zapisane wydarzenia nie są jej częścią.',
          'Google — tylko jeśli logujesz się przez Google lub łączysz folder na Dysku, i tylko w zakresie, którego to wymaga.',
        ],
      },
    ],
  },
  {
    heading: 'Jak długo je przechowujemy',
    blocks: [
      {
        kind: 'p',
        text: 'Konto i wszystko, co się w nim znajduje, przechowujemy tak długo, jak konto istnieje, bo to właśnie jest przedmiotem aplikacji. Linki do logowania szybko wygasają i są jednorazowe. Sesje wygasają same. Zaproszenia można cofnąć, a cofnięte zaproszenie przestaje działać natychmiast — plik cookie jest sprawdzany z zaproszeniem przy każdym zapytaniu, a nie zaufany raz. Na żądanie usunięcia znika konto i wszystko, co jest z nim powiązane, łącznie z subskrypcją newslettera i połączeniem z Dyskiem.',
      },
    ],
  },
  {
    heading: 'Przekazywanie danych poza Europę',
    blocks: [
      {
        kind: 'p',
        text: 'Część powyższych usług ma siedzibę w Stanach Zjednoczonych. Gdy dane osobowe do nich trafiają, podstawą przekazania jest decyzja Komisji Europejskiej z 10 lipca 2023 r. stwierdzająca odpowiedni stopień ochrony w ramach EU–US Data Privacy Framework — jeśli dostawca uzyskał certyfikację — a w pozostałych przypadkach standardowe klauzule umowne przyjęte przez Komisję na podstawie art. 46 ust. 2 lit. c RODO. Na prośbę wysłaną na {email} prześlemy zabezpieczenia dotyczące konkretnego przekazania.',
      },
    ],
  },
  {
    heading: 'Pliki cookie i dane zapisywane w przeglądarce',
    blocks: [
      {
        kind: 'p',
        text: 'Nie ma banera cookie, bo nie ma o co prosić o zgodę. Nigdzie nie ustawiamy reklamowych ani analitycznych plików cookie. To, co zapisujemy na Twoim urządzeniu, jest niezbędne do świadczenia usługi, o którą prosisz, i na podstawie art. 173 ust. 3 ustawy Prawo telekomunikacyjne nie wymaga zgody:',
      },
      {
        kind: 'list',
        items: [
          'token sesji w pamięci lokalnej, żeby utrzymać Cię zalogowanym(-ą);',
          'losowy identyfikator urządzenia w pamięci lokalnej, żeby lista przetrwała przeładowanie strony, zanim założysz konto;',
          'informacja, czy bramka zaproszeń ostatnio Cię wpuściła, żeby powracająca osoba nie widziała przez chwilę strony publicznej przed pojawieniem się aplikacji;',
          'sam plik cookie z zaproszeniem, ustawiany przez API po otwarciu linku z zaproszeniem.',
        ],
      },
      {
        kind: 'p',
        text: 'Wyczyszczenie danych tej strony w przeglądarce usuwa je wszystkie. Wyloguje Cię to i odłączy wszystko, co zapisano bez konta.',
      },
    ],
  },
  {
    heading: 'Twoje prawa',
    blocks: [
      {
        kind: 'p',
        text: 'Możesz zapytać, jakie dane o Tobie przechowujemy, poprosić o ich kopię, o ich sprostowanie albo o usunięcie wszystkich. Napisz na {email} z adresu, którego używasz do logowania — odpowie człowiek, nie formularz. Każdy newsletter ma też własny link do rezygnacji, który nie wymaga pisania do nas.',
      },
      {
        kind: 'p',
        text: 'W brzmieniu RODO są to prawa: dostępu do danych i otrzymania ich kopii (art. 15), sprostowania (art. 16), usunięcia (art. 17), ograniczenia przetwarzania (art. 18), przenoszenia danych w formacie nadającym się do odczytu maszynowego (art. 20), sprzeciwu wobec przetwarzania opartego na prawnie uzasadnionym interesie (art. 21) oraz cofnięcia udzielonej zgody (art. 7 ust. 3). Na żądanie odpowiadamy w ciągu miesiąca, zgodnie z art. 12 ust. 3.',
      },
    ],
  },
  {
    heading: 'Skargi',
    blocks: [
      {
        kind: 'p',
        text: `Skargę warto najpierw wysłać na {email}, bo zwykle da się wtedy wszystko naprawić. Masz też prawo wnieść skargę do organu nadzorczego, którym w Polsce jest ${DPA.name}, ${DPA.address}, strona: ${DPA.host}.`,
      },
    ],
  },
  {
    heading: 'Zmiany',
    blocks: [
      {
        kind: 'p',
        text: `Ta polityka jest wersjonowana razem z aplikacją, którą opisuje, a jej historia jest publiczna. Ostatnio zmieniono ją ${POLICY_UPDATED} r. Jeśli zmieni się w sposób dotyczący osób już korzystających z aplikacji, poinformujemy je e-mailem, a nie opublikujemy zmiany po cichu.`,
      },
    ],
  },
];

/**
 * The terms of use — the *regulamin* (GOI-95).
 *
 * Art. 8(1)(1) of the ustawa o świadczeniu usług drogą elektroniczną obliges
 * anyone providing a service by electronic means to make terms available free
 * of charge, in a form the user can obtain, reproduce and store, *before* they
 * use the service. Art. 8(3) fixes the minimum contents: the services offered,
 * the technical requirements, the prohibition on supplying unlawful content,
 * and the complaints procedure. There is a section for each.
 *
 * The consumer clauses are not decoration either. The app is free, but a free
 * digital service supplied in exchange for personal data is still within the
 * ustawa o prawach konsumenta as amended in 2023 — which is why the
 * fourteen-day withdrawal right is stated rather than disclaimed.
 */
export const TERMS_HEADING = 'Regulamin';
export const TERMS_UPDATED = '29 września 2026';

export const TERMS_SECTIONS: readonly PolicySection[] = [
  {
    heading: 'Kto świadczy usługę',
    blocks: [
      {
        kind: 'p',
        text: `Usługę ${NAME} świadczy ${operatorIdentity()} („Usługodawca”), z którym można się kontaktować pod adresem {email}. Niniejszy regulamin jest udostępniany nieodpłatnie przed rozpoczęciem korzystania z usługi, w formie umożliwiającej jego pozyskanie, odtwarzanie i utrwalanie, zgodnie z art. 8 ust. 1 pkt 1 ustawy o świadczeniu usług drogą elektroniczną.`,
      },
    ],
  },
  {
    heading: 'Na czym polega usługa',
    blocks: [
      {
        kind: 'p',
        text: `${NAME} odczytuje informacje o programie, które miejsca kultury publikują na własnych stronach internetowych, i przedstawia je jako jeden program. Nieodpłatnie i na zaproszenie pozwala:`,
      },
      {
        kind: 'list',
        items: [
          'przeglądać i filtrować wydarzenia;',
          'obserwować wybrane miejsca i grupować je w nazwane listy;',
          'prowadzić listę „Chcę iść” i udostępniać ją linkiem;',
          'dodawać wydarzenia do kalendarza;',
          'zamówić newsletter e-mailowy o tym, co nadchodzi w Twoich miejscach;',
          'opcjonalnie połączyć jeden folder na Dysku Google, w którym każdy newsletter będzie zapisywany jako PDF.',
        ],
      },
      {
        kind: 'p',
        text: `Nic z tego nie jest płatne i nie ma tu nic do kupienia. ${NAME} nie sprzedaje biletów, nie przyjmuje rezerwacji i nie pośredniczy między Tobą a żadnym miejscem.`,
      },
    ],
  },
  {
    heading: 'Wymagania techniczne',
    blocks: [
      {
        kind: 'p',
        text: 'Urządzenie z dostępem do internetu i aktualna wersja standardowej przeglądarki (Chrome, Firefox, Safari lub Edge) z włączoną obsługą JavaScriptu i pamięci lokalnej, a także działające zaproszenie. Do założenia konta lub zamówienia newslettera potrzebny jest adres e-mail — i nic więcej.',
      },
      {
        kind: 'p',
        text: 'Korzystanie z internetu wiąże się ze zwykłymi zagrożeniami — przechwyceniem danych w trakcie przesyłania, złośliwym oprogramowaniem czy wiadomościami podszywającymi się pod serwis. Linki do logowania wysyłamy ze zweryfikowanej domeny i nigdy nie poprosimy Cię o hasło, bo serwis go nie ma.',
      },
    ],
  },
  {
    heading: 'Twoje konto',
    blocks: [
      {
        kind: 'p',
        text: 'Logujesz się jednorazowym linkiem wysłanym na Twój adres e-mail albo kontem Google. Nie przechowujemy haseł. Każdy, kto ma dostęp do Twojej skrzynki, może więc zalogować się jako Ty: dbaj o jej bezpieczeństwo i napisz na {email}, jeśli uważasz, że ktoś inny skorzystał z Twojego konta.',
      },
      {
        kind: 'p',
        text: 'Możesz zamknąć konto w dowolnym momencie i z dowolnego powodu, pisząc na ten adres. Zamknięcie konta usuwa Twoje listy, newsletter i połączenie z Dyskiem.',
      },
    ],
  },
  {
    heading: 'Newsletter',
    blocks: [
      {
        kind: 'p',
        text: 'Newsletter jest wysyłany tylko wtedy, gdy o to poprosisz, co w rozumieniu art. 10 ustawy o świadczeniu usług drogą elektroniczną stanowi zgodę na otrzymywanie informacji handlowej drogą elektroniczną. Możesz ją w każdej chwili wycofać — linkiem do rezygnacji w każdej wiadomości albo wyłączając newsletter na swoim koncie — i działa to natychmiast. Newsletter informuje o tym, co opublikowały miejsca; nie zawiera reklam.',
      },
    ],
  },
  {
    heading: 'Zasady korzystania',
    blocks: [
      {
        kind: 'p',
        text: 'Korzystaj z usługi zgodnie z prawem i w sposób, który nie pogarsza jej działania dla innych. Zakazane jest dostarczanie treści o charakterze bezprawnym — zakaz ten, zgodnie z art. 8 ust. 3 pkt 2 lit. b wspomnianej ustawy, musi znaleźć się w regulaminie — a w szczególności nie wolno:',
      },
      {
        kind: 'list',
        items: [
          'przesyłać treści bezprawnych, naruszających czyjekolwiek prawa lub mających wprowadzać w błąd;',
          'nadawać miejscu nazwy lub tagu o charakterze zniesławiającym albo podszywającego się pod istniejącą organizację;',
          'próbować uzyskać dostęp do konta innego użytkownika lub do części usługi, które nie zostały Ci udostępnione;',
          'przekazywać zaproszenia osobie, dla której nie było przeznaczone;',
          'masowo pobierać danych z usługi, przeciążać jej lub w inny sposób zakłócać jej działanie ani obchodzić jej ograniczeń technicznych;',
          'używać usługi do wysyłania niezamówionych informacji handlowych.',
        ],
      },
      {
        kind: 'p',
        text: 'Bezprawne treści mogą zostać usunięte, a odpowiedzialne za nie konto zawieszone, zgodnie z art. 14 tej ustawy i aktem o usługach cyfrowych (DSA).',
      },
    ],
  },
  {
    heading: 'Dokładność programu',
    blocks: [
      {
        kind: 'p',
        text: `Program jest automatycznie odczytywany ze stron internetowych miejsc. Repertuary się zmieniają, seanse bywają odwoływane, a stronę można źle odczytać. Dlatego ${NAME} przedstawia te informacje orientacyjnie, a nie jako gwarancję — rozstrzygająca jest zawsze strona samego miejsca. Zanim wyjdziesz, sprawdź u organizatora — właśnie dlatego każde wydarzenie prowadzi do swojego źródła.`,
      },
      {
        kind: 'p',
        text: 'Błędne lub brakujące wydarzenie warto zgłosić na {email} — zgłoszenia są rozpatrywane.',
      },
    ],
  },
  {
    heading: 'Prawa do treści',
    blocks: [
      {
        kind: 'p',
        text: 'Projekt graficzny, kod i teksty usługi należą do Usługodawcy. Informacje o programie, tytuły, opisy i obrazy należą do miejsc oraz do podmiotów praw do opisywanych utworów i są tu pokazywane w celu informowania o tym, co się dzieje.',
      },
      {
        kind: 'p',
        text: 'Wszystko, co wpisujesz — nazwa listy, tag, własna nazwa miejsca — pozostaje Twoje. Usługodawca otrzymuje wyłącznie uprawnienie niezbędne do przechowywania tych treści, pokazywania ich Tobie i osobom, którym świadomie udostępnisz listę.',
      },
    ],
  },
  {
    heading: 'Reklamacje',
    blocks: [
      {
        kind: 'p',
        text: 'Reklamacje dotyczące usługi należy kierować na {email}. Opisz problem, kiedy wystąpił i jakiego adresu używasz w serwisie. Odpowiadamy na reklamację w ciągu 14 dni od jej otrzymania; brak odpowiedzi w tym terminie oznacza, że reklamację uznano.',
      },
    ],
  },
  {
    heading: 'Jeśli jesteś konsumentem',
    blocks: [
      {
        kind: 'p',
        text: 'Usługa jest bezpłatna, ale jest dostarczana jako usługa cyfrowa i stosuje się do niej polskie prawo konsumenckie. Możesz odstąpić od umowy w ciągu 14 dni od założenia konta, bez podawania przyczyny i bez kosztów, pisząc na {email}. W praktyce zamknięcie konta daje ten sam skutek w dowolnym momencie.',
      },
      {
        kind: 'p',
        text: 'Nic w tym regulaminie nie ogranicza Twoich praw wynikających z ustawy o prawach konsumenta ani Kodeksu cywilnego. Jeśli postanowienie regulaminu jest z nimi sprzeczne, pierwszeństwo ma prawo, a to postanowienie Ciebie nie dotyczy. Możesz też skorzystać z pozasądowych sposobów rozwiązywania sporów, w tym z pomocy miejskiego lub powiatowego rzecznika konsumentów oraz Inspekcji Handlowej; żadna ze stron nie jest do tego zobowiązana.',
      },
    ],
  },
  {
    heading: 'Odpowiedzialność i dostępność',
    blocks: [
      {
        kind: 'p',
        text: 'Usługodawca odpowiada za szkodę wynikłą z niewykonania lub nienależytego wykonania regulaminu na zasadach ogólnych Kodeksu cywilnego. Odpowiedzialność nie jest wyłączona ani ograniczona w przypadku winy umyślnej, szkody na życiu lub zdrowiu, a jeśli jesteś konsumentem — w żaden sposób, którego zabrania prawo.',
      },
      {
        kind: 'p',
        text: 'Usługa jest w zamkniętych testach i jest oferowana w obecnym stanie, bez gwarantowanego poziomu dostępności. Może być przerywana na czas prac konserwacyjnych i może zostać zakończona. W takim przypadku osoby posiadające konto zostaną z rozsądnym wyprzedzeniem powiadomione e-mailem, by mogły najpierw wyeksportować to, co chcą zachować.',
      },
    ],
  },
  {
    heading: 'Zmiany regulaminu',
    blocks: [
      {
        kind: 'p',
        text: `Regulamin może się zmienić — gdy pojawi się nowa funkcja albo zmieni się prawo. Osoby posiadające konto zostaną poinformowane e-mailem co najmniej 14 dni przed wejściem zmiany w życie i mogą do tego czasu zamknąć konto, jeśli jej nie akceptują. Dalsze korzystanie z usługi po tym terminie oznacza akceptację zmiany. Ostatnia zmiana: ${TERMS_UPDATED} r.`,
      },
    ],
  },
  {
    heading: 'Prawo właściwe',
    blocks: [
      {
        kind: 'p',
        text: 'Regulamin podlega prawu polskiemu. Jeśli jesteś konsumentem mieszkającym w innym państwie UE, nie pozbawia Cię to ochrony wynikającej z bezwzględnie obowiązujących przepisów prawa Twojego kraju. Spory rozstrzygają sądy właściwe zgodnie z Kodeksem postępowania cywilnego. Zasady przetwarzania danych osobowych opisuje polityka prywatności.',
      },
    ],
  },
];

/**
 * The `<meta name="description">`. Search results truncate around 155
 * characters, so this is written to stand alone rather than sliced out of the
 * paragraph above and cut mid-clause.
 */
export const META_DESCRIPTION = `${NAME} to agregator wydarzeń kulturalnych, który składasz sam: obserwuj kina, teatry i galerie, do których chodzisz, filtruj program i dostawaj newsletter. Dostęp na zaproszenie.`;
