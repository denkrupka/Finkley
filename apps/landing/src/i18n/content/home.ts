/**
 * Контент главной страницы по локалям (B-prime: один shared-шаблон
 * HomeBody.astro рендерит обе локали из этого модуля).
 *
 * RU — источник истины (verbatim из прежней index.astro). PL — ЧЕРНОВИК
 * перевода, ⚠️ ТРЕБУЕТ ВЫЧИТКИ НОСИТЕЛЕМ ПОЛЬСКОГО перед публикацией (owner-гейт).
 * Числа/цены в моке дашборда (€2 840, +12% и т.п.) локале-инвариантны.
 */
import type { Locale } from '../routing'

export type Feature = { title: string; text: string; emoji: string }

export type FeatureTab = {
  id: string
  label: string
  /** Пары [title, desc]. */
  items: [string, string][]
}

export type TimeSavedRow = { title: string; before: string; after: string; saved: string }

/** Пара [name, desc]. */
export type IntegrationRow = [string, string]

export type Testimonial = { initials: string; name: string; role: string; quote: string }

/** Пара [title, sub]. */
export type NotDoingRow = [string, string]

export type SecurityCard = { emoji: string; title: string; text: string }

export type Faq = { q: string; a: string }

export type HomeCopy = {
  /** <title> и meta description страницы. */
  title: string
  description: string

  hero: {
    eyebrow: string
    h1Line1: string
    h1Line2: string
    subtitle: string
    ctaLabel: string
    ctaMicrocopy: string
  }

  heroMock: {
    monthLabel: string
    deltaLabel: string
    revenueLabel: string
    expensesLabel: string
    profitLabel: string
  }

  whatsInside: { heading: string; subtitle: string; tabsIntro: string }
  timeSavedSection: {
    heading: string
    subtitle: string
    /** Итоговая сноска, центральная часть (footnoteBold) рендерится <strong>. */
    footnotePre: string
    footnoteBold: string
    footnotePost: string
    footnoteSmall: string
  }
  testimonialsSection: { heading: string; subtitle: string }
  integrationsSection: { heading: string; subtitle: string; cta: string }
  notDoingSection: { heading: string; subtitle: string }
  securitySection: {
    heading: string
    subtitle: string
    footnotePrefix: string
    footnoteLink: string
  }
  faqSection: { heading: string }
  ctaBottom: { heading: string; subtitle: string; cta: string }

  features: Feature[]
  featureTabs: FeatureTab[]
  timeSaved: TimeSavedRow[]
  integrations: IntegrationRow[]
  testimonials: Testimonial[]
  notDoing: NotDoingRow[]
  security: SecurityCard[]
  faq: Faq[]
}

const ru: HomeCopy = {
  title: 'Finkley — учёт денег и прибыли для салона красоты',
  description:
    'Finkley — управленческий учёт для салонов красоты: визиты из Booksy, расходы, зарплаты мастеров и чистая прибыль в одном месте. Демо 14 дней без карты.',

  hero: {
    eyebrow: 'Учёт денег для салонов красоты',
    h1Line1: 'Booksy показывает клиентов.',
    h1Line2: 'Мы показываем твою прибыль.',
    subtitle:
      'Ввела визит — сразу видишь, сколько заработала. Каждое утро — чёткая цифра прибыли. Без таблиц, формул и лишних звонков бухгалтеру.',
    ctaLabel: 'Начать бесплатно — 14 дней',
    ctaMicrocopy: 'Без карты, отмена в один клик',
  },

  heroMock: {
    monthLabel: 'Май 2026',
    deltaLabel: '+12% к апрелю',
    revenueLabel: 'Выручка',
    expensesLabel: 'Расходы',
    profitLabel: 'Прибыль',
  },

  whatsInside: {
    heading: 'Что внутри',
    subtitle: 'Все необходимые цифры в одном месте, без обучения.',
    tabsIntro: 'А ещё внутри есть:',
  },

  timeSavedSection: {
    heading: 'Сколько времени ты получишь обратно',
    subtitle:
      'Реальные часы в неделю, которые сейчас уходят на учёт. С Finkley — половина из них на автомате.',
    footnotePre: 'Итого в среднем — ',
    footnoteBold: '15–20 часов в месяц',
    footnotePost:
      ', которые раньше ели Excel, калькулятор и почта. И самое главное — точная цифра прибыли вместо приблизительной.',
    footnoteSmall: '* По данным первых клиентов за первые 3 месяца использования.',
  },

  testimonialsSection: {
    heading: 'Что говорят владелицы салонов',
    subtitle: 'Первые клиенты Finkley — небольшие салоны в Польше.',
  },

  integrationsSection: {
    heading: 'Подключается к тому, чем ты уже пользуешься',
    subtitle:
      'Никакого «перенесите все данные руками». Подключи нужные сервисы — данные синхронизируются автоматически в обе стороны.',
    cta: 'Подробнее про интеграции →',
  },

  notDoingSection: {
    heading: 'Что мы НЕ делаем',
    subtitle: 'Finkley — про деньги. Для остального — другие инструменты.',
  },

  securitySection: {
    heading: 'Твои данные — только твои',
    subtitle: 'Финансы салона — личное дело. Мы относимся к ним так же серьёзно, как банк.',
    footnotePrefix: 'Подробнее — в ',
    footnoteLink: 'политике приватности',
  },

  faqSection: {
    heading: 'Частые вопросы',
  },

  ctaBottom: {
    heading: '14 дней бесплатно — потом решишь',
    subtitle: 'Карта не нужна. Если не подойдёт — отмена в один клик.',
    cta: 'Начать бесплатно',
  },

  features: [
    {
      title: 'Сколько ты заработала — видно сразу',
      text: 'Открываешь приложение — первое, что видишь: сколько пришло, сколько ушло, сколько осталось. Реальные деньги, а не просто количество клиентов.',
      emoji: '💰',
    },
    {
      title: 'Работает с Booksy без переноса данных',
      text: 'Подключи один раз — визиты и оплаты сами появятся в Finkley. Ничего вводить вручную не нужно.',
      emoji: '🔄',
    },
    {
      title: 'Банк подключается автоматически',
      text: 'Поступления и расходы со счёта появляются в приложении сами. Не нужно сверять выписки вручную.',
      emoji: '🏦',
    },
    {
      title: 'Зарплаты мастеров — одной кнопкой',
      text: '% от выручки, фикс, аренда кресла или смешанная схема. В конце месяца — кнопка «Закрыть период», и расчёт готов.',
      emoji: '💸',
    },
    {
      title: 'AI-подсказки каждое утро',
      text: '«Прибыль упала на 12%, причина — рост расходов на материалы у мастера X». На русском, без курсов по аналитике.',
      emoji: '🧠',
    },
    {
      title: 'Календарь мастеров',
      text: 'Все визиты по мастерам на одной сетке. Перетаскивание мышкой, цветовые статусы, резервы времени. Готовая замена расписанию в блокноте.',
      emoji: '📅',
    },
  ],

  featureTabs: [
    {
      id: 'data',
      label: 'Учёт данных',
      items: [
        ['Визиты и оплаты', 'Подтягиваются из Booksy сами, либо вводятся вручную за 10 секунд.'],
        ['Расходы по категориям', 'Аренда, зарплата, материалы, реклама, налоги. План vs Факт.'],
        [
          'Склад и материалы',
          'Лаки, гель, расходники. Списание при продаже услуги, уведомление о низких остатках.',
        ],
        [
          'Multi-salon',
          'Несколько салонов на одном аккаунте, переключатель сверху. Каждый считается отдельно.',
        ],
      ],
    },
    {
      id: 'integrations',
      label: 'Интеграции',
      items: [
        ['Booksy', 'Двусторонняя синхронизация: визиты, клиенты, услуги, оплаты.'],
        [
          'Автоподключение к банку',
          'Через открытый банкинг ЕС — поступления и списания приходят сами.',
        ],
        [
          'Фактуры от поставщиков',
          'KSeF (налоговая в Польше), wFirma, Fakturownia, iFirma — приходят в расходы сами.',
        ],
        [
          'Telegram + Instagram + FB',
          'Все переписки с клиентами в одном окне с шаблонами и AI-помощником.',
        ],
      ],
    },
    {
      id: 'reports',
      label: 'Отчёты',
      items: [
        ['Дашборд', 'Прибыль, выручка, расходы за месяц. Динамика к прошлому периоду.'],
        ['Отчёт о прибыли (план/факт)', 'Полный отчёт по месяцам — план vs реальность.'],
        ['Движение денег', 'По дням и кассам — наличные vs безнал. Графики и накопленный остаток.'],
        [
          'Кто из клиентов приносит больше всего',
          'Топ клиентов по выручке. Кто давно не приходил — список с одной кнопкой.',
        ],
      ],
    },
    {
      id: 'time',
      label: 'Экономия времени',
      items: [
        [
          'Платёжный календарь',
          'Все будущие платежи поставщикам с напоминаниями за 2 дня до срока.',
        ],
        ['Бюджеты по категориям', 'Цели по расходам с пуш-уведомлениями при превышении.'],
        [
          'Telegram-бот',
          'Записал визит голосом в боте — попал в портал. Ежедневный дайджест в TG.',
        ],
        ['Экспорт CSV/Excel', 'В любой момент — все данные себе. Привязки к нам нет.'],
      ],
    },
  ],

  timeSaved: [
    {
      title: 'Учёт визитов',
      before: '~20 мин/день вручную в Excel',
      after: 'Автосинхр из Booksy — 0 мин',
      saved: '~10 часов / мес',
    },
    {
      title: 'Расходы и фактуры',
      before: '~30 мин/неделю заносить из почты',
      after: 'KSeF и wFirma тянут сами',
      saved: '~2 часа / мес',
    },
    {
      title: 'Зарплаты мастеров',
      before: '~2 часа в конце месяца с калькулятором',
      after: 'Кнопка «Закрыть период»',
      saved: '~2 часа / мес',
    },
    {
      title: 'Финансовый отчёт',
      before: 'Целый день в конце квартала',
      after: 'Готов в реалтайме',
      saved: '~8 часов / квартал',
    },
    {
      title: 'Платёжный календарь',
      before: 'Просрочки, штрафы, пропущенные счета',
      after: 'Пуш + email + TG за 2 дня до срока',
      saved: 'Деньги на штрафах',
    },
    {
      title: 'Принятие решений',
      before: 'Интуиция без цифр',
      after: 'AI-подсказки каждое утро',
      saved: '+12% прибыли*',
    },
  ],

  integrations: [
    ['Booksy', 'Запись и календарь'],
    ['Fresha', 'Запись (в разработке)'],
    ['KSeF', 'Налоговая в Польше'],
    ['wFirma', 'Бухгалтерия'],
    ['Fakturownia', 'Бухгалтерия'],
    ['iFirma', 'Бухгалтерия'],
    ['Банк ЕС', 'Автоподключение через открытый банкинг'],
    ['Stripe', 'Подписка'],
    ['Telegram', 'Бот + мессенджер'],
    ['Instagram + FB', 'Мессенджер'],
    ['Google OAuth', 'Логин'],
  ],

  testimonials: [
    {
      initials: 'MK',
      name: 'Magda K.',
      role: 'Владелица студии маникюра, Warszawa',
      quote:
        'Раньше я закрывала месяц в Excel два вечера. Теперь — открываю приложение утром и сразу вижу, сколько заработала. На сверку выписок уходит 5 минут вместо часа.',
    },
    {
      initials: 'AP',
      name: 'Anna P.',
      role: 'Салон красоты, Kraków',
      quote:
        'Зарплаты трём мастерам считала вручную с калькулятором. Сейчас нажимаю «Закрыть период» — и готово. Высвободилось 2 часа в конце каждого месяца.',
    },
    {
      initials: 'OL',
      name: 'Olga L.',
      role: 'Барбершоп, Wrocław',
      quote:
        'Самое полезное — AI-подсказки. На прошлой неделе подсветил, что один мастер съел много расходников. Я бы сама не заметила.',
    },
  ],

  notDoing: [
    ['Не заменяем Booksy', 'Записи клиентов остаются там, где привыкла'],
    ['Не делаем налоговую отчётность', 'Бухгалтер всё ещё нужен для отчётов в налоговую'],
    [
      'Не ведём полноценный склад производства',
      'Простой учёт материалов есть, но это не полноценная складская система',
    ],
    ['Не считаем зарплату по часам', 'Только % от выручки, фикс или аренда кресла на старте'],
  ],

  security: [
    {
      emoji: '🇪🇺',
      title: 'Хранятся в Европе',
      text: 'Серверы во Франкфурте (Германия), всё под GDPR. Данные не покидают ЕС.',
    },
    {
      emoji: '🔒',
      title: 'Шифрование на всех уровнях',
      text: 'Данные зашифрованы при хранении (AES-256) и при передаче (TLS). Пароли и доступы к банку и Booksy — под отдельным ключом.',
    },
    {
      emoji: '🙈',
      title: 'Никто посторонний не видит',
      text: 'Доступ к твоему салону — только у тебя и тех, кого ты сама пригласила. Соседний салон не увидит ни одной твоей цифры.',
    },
    {
      emoji: '🧾',
      title: 'Мы не передаём данные в налоговую',
      text: 'Finkley не делится твоими данными с налоговой или третьими лицами. Захочешь уйти — выгрузишь всё в CSV и удалишь аккаунт в один клик.',
    },
  ],

  faq: [
    {
      q: 'Это же просто ещё один Excel?',
      a: 'Excel — отличный инструмент, но он не считает прибыль автоматически. Finkley делает это за тебя и показывает цифру первой строкой каждый раз, когда ты заходишь.',
    },
    {
      q: 'Я всю жизнь веду учёт в тетради. Зачем мне это?',
      a: 'Тетрадь честно работает — пока она одна и всё сходится в голове. Сложности приходят позже: тетрадь не откроешь из дома, её легко потерять или залить кофе, а чтобы понять «в этом месяце я заработала больше или меньше» — надо сесть и всё пересчитать руками. Finkley делает то же, что тетрадь, только сам считает итоги, хранит копию в облаке и показывает прибыль одной цифрой. Заносить визиты можно так же быстро — или вообще голосом через Telegram. Тетрадь оставь для заметок, а деньги пусть считает приложение.',
    },
    {
      q: 'Чем это отличается от Booksy?',
      a: 'Booksy — система записи клиентов. Finkley — учёт денег салона. Можно использовать вместе: Booksy для записи, Finkley для денег.',
    },
    {
      q: 'Учёт визитов и зарплат у меня уже есть в Booksy. Зачем тогда вы?',
      a: 'Booksy отлично показывает, сколько у тебя записей и клиентов. Но он не отвечает на главный вопрос — сколько ты реально заработала после аренды, материалов, налогов и зарплат. Finkley берёт визиты и оплаты прямо из Booksy (заново вводить ничего не нужно), добавляет к ним расходы и считает чистую прибыль. Плюс зарплаты мастеров: процент, фикс или аренда кресла — нажимаешь «Закрыть период», и расчёт готов. Booksy — про запись клиентов, Finkley — про деньги.',
    },
    {
      q: 'Сколько стоит?',
      a: 'Платные тарифы от €19/мес. Есть бесплатный тариф навсегда (учёт доходов) и демо на 14 дней со всеми разделами — без карты. Тарифы выше открывают расходы, отчёты, маркетинг, AI-помощника, финансы, склад и мульти-салон. Подробности — на странице тарифов.',
    },
    {
      q: 'А если я не хочу платить?',
      a: 'Остаёшься на бесплатном тарифе навсегда: доступен раздел «Доходы» (учёт визитов и выручки), остальные разделы видно, но они заблокированы. Перейти на платный тариф можно в любой момент.',
    },
    {
      q: 'А мои данные?',
      a: 'Все данные хранятся в Supabase в ЕС (Франкфурт), зашифрованы и защищены. При удалении аккаунта — 30 дней на раздумье, потом удаление данных навсегда. Можно экспортировать всё в CSV в любой момент.',
    },
    {
      q: 'А если у меня несколько салонов?',
      a: 'Один аккаунт — несколько салонов с переключателем сверху, каждый салон считается отдельно. Мульти-салон входит в тариф €99/мес.',
    },
  ],
}

// ⚠️ PL — машинный черновик, ТРЕБУЕТ ВЫЧИТКИ НОСИТЕЛЕМ ПОЛЬСКОГО перед публикацией.
// Имена мастеров в моке (Аня/Катя/Марина) и отзывах (Magda/Anna/Olga) — демо,
// оставлены/транслитерированы как есть.
const pl: HomeCopy = {
  title: 'Finkley — kontrola pieniędzy i zysku dla salonu piękności',
  description:
    'Finkley — rachunkowość zarządcza dla salonów piękności: wizyty z Booksy, koszty, wynagrodzenia specjalistów i zysk netto w jednym miejscu. Demo 14 dni bez karty.',

  hero: {
    eyebrow: 'Kontrola pieniędzy dla salonów piękności',
    h1Line1: 'Booksy pokazuje klientów.',
    h1Line2: 'My pokazujemy Twój zysk.',
    subtitle:
      'Dodajesz wizytę — i od razu widzisz, ile zarobiłaś. Każdego ranka masz konkretną liczbę zysku. Bez tabel, formuł i zbędnych telefonów do księgowej.',
    ctaLabel: 'Zacznij za darmo — 14 dni',
    ctaMicrocopy: 'Bez karty, anulujesz jednym kliknięciem',
  },

  heroMock: {
    monthLabel: 'Maj 2026',
    deltaLabel: '+12% do kwietnia',
    revenueLabel: 'Przychody',
    expensesLabel: 'Koszty',
    profitLabel: 'Zysk',
  },

  whatsInside: {
    heading: 'Co znajdziesz w środku',
    subtitle: 'Wszystkie potrzebne liczby w jednym miejscu, bez uczenia się obsługi.',
    tabsIntro: 'A oprócz tego znajdziesz:',
  },

  timeSavedSection: {
    heading: 'Ile czasu odzyskasz',
    subtitle:
      'Realne godziny w tygodniu, które dziś pochłania prowadzenie rozliczeń. Z Finkley połowa z nich dzieje się automatycznie.',
    footnotePre: 'Łącznie średnio ',
    footnoteBold: '15–20 godzin miesięcznie',
    footnotePost:
      ', które wcześniej pochłaniały Excel, kalkulator i poczta. A co najważniejsze — dokładna liczba zysku zamiast szacunków.',
    footnoteSmall: '* Na podstawie danych pierwszych klientek z pierwszych 3 miesięcy korzystania.',
  },

  testimonialsSection: {
    heading: 'Co mówią właścicielki salonów',
    subtitle: 'Pierwsze klientki Finkley to małe salony w Polsce.',
  },

  integrationsSection: {
    heading: 'Łączy się z tym, czego już używasz',
    subtitle:
      'Żadnego „przepisz wszystkie dane ręcznie". Podłącz potrzebne usługi, a dane będą synchronizować się automatycznie w obie strony.',
    cta: 'Więcej o integracjach →',
  },

  notDoingSection: {
    heading: 'Czego NIE robimy',
    subtitle: 'Finkley jest o pieniądzach. Do reszty masz inne narzędzia.',
  },

  securitySection: {
    heading: 'Twoje dane są tylko Twoje',
    subtitle: 'Finanse salonu to sprawa prywatna. Traktujemy je równie poważnie jak bank.',
    footnotePrefix: 'Więcej w ',
    footnoteLink: 'polityce prywatności',
  },

  faqSection: {
    heading: 'Najczęstsze pytania',
  },

  ctaBottom: {
    heading: '14 dni za darmo — potem zdecydujesz',
    subtitle: 'Karta nie jest potrzebna. Jeśli nie podejdzie — anulujesz jednym kliknięciem.',
    cta: 'Zacznij za darmo',
  },

  features: [
    {
      title: 'Ile zarobiłaś — widać od razu',
      text: 'Otwierasz aplikację i od razu widzisz: ile wpłynęło, ile wyszło, ile zostało. Realne pieniądze, a nie tylko liczba klientów.',
      emoji: '💰',
    },
    {
      title: 'Działa z Booksy bez przepisywania danych',
      text: 'Podłączasz raz, a wizyty i płatności same pojawiają się w Finkley. Niczego nie trzeba wpisywać ręcznie.',
      emoji: '🔄',
    },
    {
      title: 'Bank podłącza się automatycznie',
      text: 'Wpływy i koszty z konta pojawiają się w aplikacji same. Nie musisz ręcznie sprawdzać wyciągów.',
      emoji: '🏦',
    },
    {
      title: 'Wynagrodzenia specjalistów — jednym przyciskiem',
      text: '% od utargu, stała kwota, wynajem fotela albo schemat mieszany. Na koniec miesiąca klikasz „Zamknij okres" i wyliczenie jest gotowe.',
      emoji: '💸',
    },
    {
      title: 'Podpowiedzi AI każdego ranka',
      text: '„Zysk spadł o 12%, przyczyną jest wzrost kosztów materiałów u specjalistki X". Po polsku, bez kursów z analityki.',
      emoji: '🧠',
    },
    {
      title: 'Kalendarz specjalistów',
      text: 'Wszystkie wizyty według specjalistów na jednej siatce. Przeciąganie myszką, kolorowe statusy, rezerwacje czasu. Gotowy zamiennik grafiku w notesie.',
      emoji: '📅',
    },
  ],

  featureTabs: [
    {
      id: 'data',
      label: 'Ewidencja danych',
      items: [
        [
          'Wizyty i płatności',
          'Pobierają się z Booksy same albo wpisujesz je ręcznie w 10 sekund.',
        ],
        [
          'Koszty według kategorii',
          'Najem, wynagrodzenia, materiały, reklama, podatki. Plan vs wykonanie.',
        ],
        [
          'Magazyn i materiały',
          'Lakiery, żel, materiały zużywalne. Odpis przy sprzedaży usługi i powiadomienie o niskim stanie.',
        ],
        [
          'Multi-salon',
          'Kilka salonów na jednym koncie, przełącznik u góry. Każdy liczony osobno.',
        ],
      ],
    },
    {
      id: 'integrations',
      label: 'Integracje',
      items: [
        ['Booksy', 'Dwukierunkowa synchronizacja: wizyty, klienci, usługi, płatności.'],
        [
          'Automatyczne podłączenie banku',
          'Przez otwartą bankowość UE — wpływy i wydatki pojawiają się same.',
        ],
        [
          'Faktury od dostawców',
          'KSeF (urząd skarbowy w Polsce), wFirma, Fakturownia, iFirma — same trafiają do kosztów.',
        ],
        [
          'Telegram + Instagram + FB',
          'Wszystkie rozmowy z klientami w jednym oknie, z szablonami i asystentem AI.',
        ],
      ],
    },
    {
      id: 'reports',
      label: 'Raporty',
      items: [
        ['Pulpit', 'Zysk, przychody i koszty za miesiąc. Zmiana względem poprzedniego okresu.'],
        [
          'Raport o zysku (plan/wykonanie)',
          'Pełny raport według miesięcy — plan vs rzeczywistość.',
        ],
        [
          'Przepływy pieniężne',
          'Według dni i kas — gotówka vs przelew. Wykresy i narastające saldo.',
        ],
        [
          'Które klientki przynoszą najwięcej',
          'Najlepsze klientki według utargu. Kto dawno nie był — lista jednym przyciskiem.',
        ],
      ],
    },
    {
      id: 'time',
      label: 'Oszczędność czasu',
      items: [
        [
          'Kalendarz płatności',
          'Wszystkie przyszłe płatności do dostawców z przypomnieniem 2 dni przed terminem.',
        ],
        ['Budżety według kategorii', 'Cele kosztowe z powiadomieniami push przy przekroczeniu.'],
        [
          'Bot Telegram',
          'Zapisujesz wizytę głosem w bocie — trafia do portalu. Codzienne podsumowanie w TG.',
        ],
        [
          'Eksport CSV/Excel',
          'W każdej chwili pobierzesz wszystkie swoje dane. Niczym Cię nie wiążemy.',
        ],
      ],
    },
  ],

  timeSaved: [
    {
      title: 'Ewidencja wizyt',
      before: '~20 min dziennie ręcznie w Excelu',
      after: 'Automatyczna synchronizacja z Booksy — 0 min',
      saved: '~10 godzin / mies.',
    },
    {
      title: 'Koszty i faktury',
      before: '~30 min tygodniowo na wpisywanie z poczty',
      after: 'KSeF i wFirma pobierają same',
      saved: '~2 godziny / mies.',
    },
    {
      title: 'Wynagrodzenia specjalistów',
      before: '~2 godziny na koniec miesiąca z kalkulatorem',
      after: 'Przycisk „Zamknij okres"',
      saved: '~2 godziny / mies.',
    },
    {
      title: 'Raport finansowy',
      before: 'Cały dzień na koniec kwartału',
      after: 'Gotowy w czasie rzeczywistym',
      saved: '~8 godzin / kwartał',
    },
    {
      title: 'Kalendarz płatności',
      before: 'Zaległości, kary, pominięte faktury',
      after: 'Push + e-mail + TG 2 dni przed terminem',
      saved: 'Oszczędność na karach',
    },
    {
      title: 'Podejmowanie decyzji',
      before: 'Intuicja bez liczb',
      after: 'Podpowiedzi AI każdego ranka',
      saved: '+12% zysku*',
    },
  ],

  integrations: [
    ['Booksy', 'Rezerwacje i kalendarz'],
    ['Fresha', 'Rezerwacje (w przygotowaniu)'],
    ['KSeF', 'Urząd skarbowy w Polsce'],
    ['wFirma', 'Księgowość'],
    ['Fakturownia', 'Księgowość'],
    ['iFirma', 'Księgowość'],
    ['Bank UE', 'Automatyczne podłączenie przez otwartą bankowość'],
    ['Stripe', 'Subskrypcja'],
    ['Telegram', 'Bot i komunikator'],
    ['Instagram + FB', 'Komunikator'],
    ['Google OAuth', 'Logowanie'],
  ],

  testimonials: [
    {
      initials: 'MK',
      name: 'Magda K.',
      role: 'Właścicielka studia manicure, Warszawa',
      quote:
        'Wcześniej zamykałam miesiąc w Excelu przez dwa wieczory. Teraz otwieram aplikację rano i od razu widzę, ile zarobiłam. Uzgodnienie wyciągów zajmuje 5 minut zamiast godziny.',
    },
    {
      initials: 'AP',
      name: 'Anna P.',
      role: 'Salon piękności, Kraków',
      quote:
        'Wynagrodzenia trzech specjalistek liczyłam ręcznie na kalkulatorze. Teraz klikam „Zamknij okres" i jest gotowe. Co miesiąc oszczędzam dzięki temu 2 godziny.',
    },
    {
      initials: 'OL',
      name: 'Olga L.',
      role: 'Barbershop, Wrocław',
      quote:
        'Najbardziej przydatne są podpowiedzi AI. W zeszłym tygodniu zwróciły mi uwagę, że jedna osoba zużyła dużo materiałów. Sama bym tego nie zauważyła.',
    },
  ],

  notDoing: [
    ['Nie zastępujemy Booksy', 'Rezerwacje klientów zostają tam, gdzie się do nich przyzwyczaiłaś'],
    ['Nie robimy rozliczeń podatkowych', 'Księgowa nadal jest potrzebna do rozliczeń w urzędzie'],
    [
      'Nie prowadzimy pełnego magazynu produkcyjnego',
      'Prosta ewidencja materiałów jest, ale to nie pełny system magazynowy',
    ],
    [
      'Nie liczymy wynagrodzeń godzinowo',
      'Na start tylko % od utargu, stała kwota lub wynajem fotela',
    ],
  ],

  security: [
    {
      emoji: '🇪🇺',
      title: 'Przechowywane w Europie',
      text: 'Serwery we Frankfurcie (Niemcy), wszystko zgodnie z RODO. Dane nie opuszczają UE.',
    },
    {
      emoji: '🔒',
      title: 'Szyfrowanie na każdym etapie',
      text: 'Dane są szyfrowane podczas przechowywania (AES-256) i podczas przesyłania (TLS). Hasła oraz dostępy do banku i Booksy chronimy osobnym kluczem.',
    },
    {
      emoji: '🙈',
      title: 'Nikt postronny nic nie zobaczy',
      text: 'Dostęp do Twojego salonu masz tylko Ty i osoby, które sama zaprosisz. Sąsiedni salon nie zobaczy ani jednej Twojej liczby.',
    },
    {
      emoji: '🧾',
      title: 'Nie przekazujemy danych do urzędu skarbowego',
      text: 'Finkley nie dzieli się Twoimi danymi z urzędem skarbowym ani z osobami trzecimi. Jeśli zechcesz odejść, wyeksportujesz wszystko do CSV i usuniesz konto jednym kliknięciem.',
    },
  ],

  faq: [
    {
      q: 'Przecież to po prostu kolejny Excel?',
      a: 'Excel to świetne narzędzie, ale nie liczy zysku automatycznie. Finkley robi to za Ciebie i pokazuje gotową liczbę w pierwszym wierszu za każdym razem, gdy wchodzisz do aplikacji.',
    },
    {
      q: 'Całe życie prowadzę zapiski w zeszycie. Po co mi to?',
      a: 'Zeszyt dobrze się sprawdza, dopóki jest jeden i wszystko zgadza się w głowie. Trudności przychodzą później: zeszytu nie otworzysz z domu, łatwo go zgubić albo zalać kawą, a żeby sprawdzić, czy w tym miesiącu zarobiłaś więcej czy mniej, trzeba usiąść i wszystko przeliczyć ręcznie. Finkley robi to samo co zeszyt, tylko sam liczy sumy, trzyma kopię w chmurze i pokazuje zysk jedną liczbą. Wizyty wpisujesz równie szybko — albo w ogóle dyktujesz głosem przez Telegram. Zeszyt zostaw na notatki, a pieniądze niech liczy aplikacja.',
    },
    {
      q: 'Czym to się różni od Booksy?',
      a: 'Booksy to system rezerwacji klientów. Finkley to kontrola pieniędzy salonu. Możesz korzystać z obu naraz: Booksy do rezerwacji, Finkley do pieniędzy.',
    },
    {
      q: 'Ewidencję wizyt i wynagrodzeń mam już w Booksy. Po co mi więc wy?',
      a: 'Booksy świetnie pokazuje, ile masz rezerwacji i klientów. Nie odpowiada jednak na najważniejsze pytanie — ile realnie zarobiłaś po odjęciu najmu, materiałów, podatków i wynagrodzeń. Finkley bierze wizyty i płatności prosto z Booksy (niczego nie wpisujesz ponownie), dodaje do nich koszty i liczy zysk netto. Do tego wynagrodzenia specjalistów: procent, stała kwota lub wynajem fotela — klikasz „Zamknij okres" i wyliczenie jest gotowe. Booksy jest o rezerwacjach klientów, Finkley o pieniądzach.',
    },
    {
      q: 'Ile to kosztuje?',
      a: 'Plany płatne zaczynają się od €19/mies. Jest też darmowy plan na zawsze (ewidencja przychodów) oraz demo na 14 dni ze wszystkimi sekcjami — bez karty. Wyższe plany otwierają koszty, raporty, marketing, asystenta AI, finanse, magazyn i multi-salon. Szczegóły znajdziesz na stronie cennika.',
    },
    {
      q: 'A jeśli nie chcę płacić?',
      a: 'Zostajesz na darmowym planie na zawsze: dostępna jest sekcja „Przychody" (ewidencja wizyt i utargu), pozostałe sekcje widzisz, ale są zablokowane. Na plan płatny możesz przejść w dowolnej chwili.',
    },
    {
      q: 'A co z moimi danymi?',
      a: 'Wszystkie dane przechowujemy w Supabase na terenie UE (Frankfurt), zaszyfrowane i chronione. Po usunięciu konta masz 30 dni do namysłu, a potem dane są trwale usuwane. Wszystko możesz w każdej chwili wyeksportować do CSV.',
    },
    {
      q: 'A jeśli mam kilka salonów?',
      a: 'Jedno konto, a w nim kilka salonów z przełącznikiem u góry — każdy salon liczony osobno. Multi-salon wchodzi w plan €99/mies.',
    },
  ],
}

export const homeContent: Record<Locale, HomeCopy> = { ru, pl }

/**
 * Строит JSON-LD (FAQPage) для главной — отзеркаливает видимый FAQ (copy.faq).
 * Даёт rich result в Google и извлекаемые ответы для AI-движков.
 */
export function buildHomeJsonLd(copy: HomeCopy): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: copy.faq.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
}
