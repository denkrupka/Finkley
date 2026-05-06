/* FinSalon — AI Assistant + Onboarding + Mobile */
const T3 = window.TOKENS;
const Icon3 = window.Icon;
const fmt3 = window.fmt;
const Card3 = window.Card;

/* ---------------- AI ASSISTANT (Screen 4) ---------------- */
const QUICK_PROMPTS = [
  "Покажи мои лучшие услуги по марже",
  "Какой мастер приносит меньше всего?",
  "Сравни этот месяц с прошлым",
  "Почему упала выручка на этой неделе?",
  "Рассчитай точку безубыточности",
  "Сколько я зарабатываю в час?",
];

const MARGIN_DATA = [
  { name: "Ламинирование бровей", margin: 68, color: T3.sage },
  { name: "Маникюр гель", margin: 52, color: T3.sage },
  { name: "Педикюр", margin: 44, color: T3.gold },
  { name: "Стрижка", margin: 41, color: T3.gold },
  { name: "Окрашивание", margin: 31, color: T3.red },
];

const MiniBars = ({ data }) => {
  const max = 80;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
      {data.map((d) => (
        <div key={d.name} style={{ display: "grid", gridTemplateColumns: "150px 1fr 50px", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12.5, color: T3.text, fontWeight: 500 }}>{d.name}</span>
          <div style={{ height: 18, background: T3.bg, borderRadius: 5, overflow: "hidden" }}>
            <div style={{ width: `${(d.margin / max) * 100}%`, height: "100%", background: d.color, borderRadius: 5 }} />
          </div>
          <span className="num" style={{ fontSize: 13, fontWeight: 700, color: T3.navy, textAlign: "right" }}>
            {d.margin}%
          </span>
        </div>
      ))}
    </div>
  );
};

const AIScreen = ({ period, onPeriod, onAddVisit }) => {
  const [input, setInput] = React.useState("");
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: T3.bg }}>
      <window.TopBar period={period} onPeriod={onPeriod} />
      <main style={{ flex: 1, display: "grid", gridTemplateColumns: "300px 1fr", overflow: "hidden" }}>
        {/* Left panel: quick prompts */}
        <aside style={{ borderRight: `1px solid ${T3.border}`, background: T3.card, padding: "26px 22px", overflow: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: T3.teal, display: "grid", placeItems: "center" }}>
              <Icon3 name="robot" size={18} color="white" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T3.navy }}>FinSalon AI</div>
              <div style={{ fontSize: 11, color: T3.sage, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: T3.sage }} /> Онлайн
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: T3.textFaint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Быстрые вопросы
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                style={{
                  textAlign: "left",
                  padding: "11px 13px",
                  borderRadius: 10,
                  border: `1px solid ${T3.border}`,
                  background: T3.card,
                  fontSize: 13,
                  color: T3.text,
                  fontFamily: "inherit",
                  fontWeight: 500,
                  cursor: "pointer",
                  lineHeight: 1.35,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = T3.tealSoft; e.currentTarget.style.borderColor = T3.teal; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = T3.card; e.currentTarget.style.borderColor = T3.border; }}
              >
                {p}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 24, padding: 14, background: T3.bg, borderRadius: 10, fontSize: 11.5, color: T3.textMuted, lineHeight: 1.5 }}>
            <strong style={{ color: T3.navy }}>Приватность.</strong> Твои данные не передаются налоговой и не используются для обучения.
          </div>
        </aside>

        {/* Right: chat */}
        <section style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div className="scrollbar-thin" style={{ flex: 1, overflow: "auto", padding: "28px 36px 20px" }}>
            <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
              {/* AI greeting */}
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: T3.teal, display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Icon3 name="robot" size={15} color="white" />
                </div>
                <div style={{ background: T3.card, border: `1px solid ${T3.border}`, borderLeft: `3px solid ${T3.teal}`, borderRadius: 12, padding: "14px 16px", fontSize: 14, color: T3.text, lineHeight: 1.55 }}>
                  Привет, Оля! 👋 Я разобрал твои данные за май. Спрашивай — отвечу с цифрами и графиками. 
                  Или нажми один из быстрых вопросов слева.
                </div>
              </div>

              {/* User message */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{ background: T3.navy, color: "white", borderRadius: 12, padding: "12px 16px", fontSize: 14, maxWidth: "70%" }}>
                  Покажи мои лучшие услуги по марже
                </div>
              </div>

              {/* AI response with chart */}
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: T3.teal, display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Icon3 name="robot" size={15} color="white" />
                </div>
                <div style={{ flex: 1, background: T3.card, border: `1px solid ${T3.border}`, borderLeft: `3px solid ${T3.teal}`, borderRadius: 12, padding: "16px 18px", fontSize: 14, color: T3.text, lineHeight: 1.55 }}>
                  <div style={{ marginBottom: 14 }}>
                    Твои <strong>топ-услуги по марже</strong> за май:
                  </div>
                  <div style={{ background: T3.bg, borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
                    <MiniBars data={MARGIN_DATA} />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "12px 14px",
                      background: T3.redSoft,
                      borderRadius: 10,
                      borderLeft: `3px solid ${T3.red}`,
                      marginBottom: 12,
                    }}
                  >
                    <Icon3 name="warning" size={18} color={T3.red} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div style={{ fontSize: 13, color: T3.text, lineHeight: 1.5 }}>
                      <strong>Окрашивание теряет маржу</strong> из-за роста стоимости материалов 
                      (<span className="num" style={{ color: T3.red, fontWeight: 700 }}>+18%</span> с августа). 
                      Рекомендую пересмотреть цену на <span className="num" style={{ fontWeight: 700 }}>€8–12</span>.
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["Пересчитать цену", "Сравнить с прошлым годом", "Подробнее"].map((b) => (
                      <button key={b} style={{
                        padding: "6px 12px", borderRadius: 999, border: `1px solid ${T3.teal}`,
                        background: "transparent", color: T3.teal, fontSize: 12, fontWeight: 600,
                        cursor: "pointer", fontFamily: "inherit",
                      }}>{b}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* User follow-up */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{ background: T3.navy, color: "white", borderRadius: 12, padding: "12px 16px", fontSize: 14, maxWidth: "70%" }}>
                  А кто из мастеров приносит меньше всего?
                </div>
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: T3.teal, display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Icon3 name="robot" size={15} color="white" />
                </div>
                <div style={{ flex: 1, background: T3.card, border: `1px solid ${T3.border}`, borderLeft: `3px solid ${T3.teal}`, borderRadius: 12, padding: "16px 18px", fontSize: 14, color: T3.text, lineHeight: 1.55, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "inline-flex", gap: 4 }}>
                    {[0,1,2].map((i) => (
                      <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: T3.teal, opacity: 0.3 + i*0.2 }} />
                    ))}
                  </span>
                  <span style={{ color: T3.textMuted, fontStyle: "italic" }}>Считаю...</span>
                </div>
              </div>
            </div>
          </div>

          {/* Input */}
          <div style={{ borderTop: `1px solid ${T3.border}`, padding: "16px 36px 20px", background: T3.card }}>
            <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", gap: 10, alignItems: "center", background: T3.bg, border: `1.5px solid ${T3.border}`, borderRadius: 12, padding: "6px 6px 6px 16px" }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Спроси что-нибудь о своём салоне..."
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14, fontFamily: "inherit", padding: "10px 0", color: T3.text }}
              />
              <button style={{ width: 38, height: 38, borderRadius: 9, background: T3.navy, border: "none", display: "grid", placeItems: "center", cursor: "pointer" }}>
                <Icon3 name="send" size={16} color="white" />
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

/* ---------------- ONBOARDING (Screen 5) ---------------- */
const ONBOARD_STEPS = ["Салон", "Мастера", "Услуги", "Расходы", "Готово"];

const OnboardingScreen = () => {
  const currentStep = 1; // step 2 (zero-indexed)
  const [specs, setSpecs] = React.useState(["Маникюр", "Педикюр"]);
  const [scheme, setScheme] = React.useState("percent");
  const [percentVal, setPercentVal] = React.useState("40");
  const [name, setName] = React.useState("");
  const allSpecs = ["Маникюр", "Педикюр", "Брови", "Ресницы", "Массаж", "Волосы", "Окрашивание", "Депиляция"];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T3.bg, overflow: "auto" }} className="scrollbar-thin">
      {/* Mini topbar */}
      <header style={{ height: 64, padding: "0 36px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${T3.border}`, background: T3.card }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: T3.navy, display: "grid", placeItems: "center", color: "white", fontWeight: 800, fontSize: 13 }}>F</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: T3.navy, letterSpacing: "-0.02em" }}>FinSalon</div>
        </div>
        <a style={{ fontSize: 13, color: T3.textMuted, cursor: "pointer", fontWeight: 500 }}>Выйти</a>
      </header>

      <main style={{ flex: 1, padding: "40px 32px 60px", display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 880 }}>
          {/* Stepper */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T3.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Шаг {currentStep + 1} из 5
              </span>
              <span style={{ fontSize: 12, color: T3.textMuted }}>≈ 2 минуты</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {ONBOARD_STEPS.map((s, i) => {
                const done = i < currentStep;
                const active = i === currentStep;
                return (
                  <div key={s} style={{ flex: 1 }}>
                    <div style={{
                      height: 5, borderRadius: 999,
                      background: done || active ? T3.navy : T3.border,
                      marginBottom: 8,
                    }} />
                    <div style={{ fontSize: 11.5, fontWeight: active ? 700 : 500, color: active ? T3.navy : done ? T3.text : T3.textFaint }}>
                      {s}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Heading */}
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 30, fontWeight: 800, color: T3.navy, margin: 0, letterSpacing: "-0.025em" }}>
              Добавь своих мастеров
            </h1>
            <div style={{ fontSize: 15, color: T3.textMuted, marginTop: 8, lineHeight: 1.5 }}>
              Это займёт 2 минуты. Потом можно дополнить и поменять.
            </div>
          </div>

          {/* Master cards grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 22 }}>
            {/* Saved master */}
            <div style={{ background: T3.card, borderRadius: 14, border: `1px solid ${T3.border}`, padding: 18, position: "relative", boxShadow: T3.shadowSm }}>
              <div style={{ position: "absolute", top: 12, right: 12, width: 22, height: 22, borderRadius: "50%", background: T3.sage, display: "grid", placeItems: "center" }}>
                <Icon3 name="check" size={13} color="white" strokeWidth={2.5} />
              </div>
              <div style={{ width: 50, height: 50, borderRadius: "50%", background: "#F4D7C5", display: "grid", placeItems: "center", color: T3.navy, fontWeight: 700, fontSize: 18, marginBottom: 12 }}>
                А
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T3.text, marginBottom: 4 }}>Аня</div>
              <div style={{ fontSize: 12, color: T3.textMuted, marginBottom: 10 }}>Маникюр · Педикюр</div>
              <div style={{ fontSize: 11, color: T3.teal, fontWeight: 600, padding: "3px 8px", background: T3.tealSoft, borderRadius: 999, display: "inline-block" }}>
                40% от выручки
              </div>
            </div>

            {/* Saved master 2 */}
            <div style={{ background: T3.card, borderRadius: 14, border: `1px solid ${T3.border}`, padding: 18, position: "relative", boxShadow: T3.shadowSm }}>
              <div style={{ position: "absolute", top: 12, right: 12, width: 22, height: 22, borderRadius: "50%", background: T3.sage, display: "grid", placeItems: "center" }}>
                <Icon3 name="check" size={13} color="white" strokeWidth={2.5} />
              </div>
              <div style={{ width: 50, height: 50, borderRadius: "50%", background: "#D7E4C5", display: "grid", placeItems: "center", color: T3.navy, fontWeight: 700, fontSize: 18, marginBottom: 12 }}>
                К
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T3.text, marginBottom: 4 }}>Катя</div>
              <div style={{ fontSize: 12, color: T3.textMuted, marginBottom: 10 }}>Брови · Ресницы</div>
              <div style={{ fontSize: 11, color: T3.teal, fontWeight: 600, padding: "3px 8px", background: T3.tealSoft, borderRadius: 999, display: "inline-block" }}>
                45% от выручки
              </div>
            </div>

            {/* Add new — expanded form */}
            <div style={{ background: T3.card, borderRadius: 14, border: `2px dashed ${T3.teal}`, padding: 18, gridRow: "span 2", boxShadow: `0 0 0 4px ${T3.tealSoft}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T3.teal, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
                Новый мастер
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T3.textMuted, marginBottom: 6, display: "block" }}>Имя мастера</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Например, Марина"
                    style={{ width: "100%", height: 42, borderRadius: 9, border: `1.5px solid ${T3.border}`, padding: "0 12px", fontSize: 14, fontFamily: "inherit", outline: "none" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T3.textMuted, marginBottom: 6, display: "block" }}>Специализация</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {allSpecs.map((s) => {
                      const on = specs.includes(s);
                      return (
                        <button
                          key={s}
                          onClick={() => setSpecs(on ? specs.filter(x => x !== s) : [...specs, s])}
                          style={{
                            padding: "5px 11px", borderRadius: 999,
                            border: `1.5px solid ${on ? T3.navy : T3.border}`,
                            background: on ? T3.navy : T3.card,
                            color: on ? "white" : T3.text,
                            fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >
                          {on && "✓ "}{s}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T3.textMuted, marginBottom: 6, display: "block" }}>Схема оплаты</label>
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    {[
                      { id: "percent", label: "% от выручки" },
                      { id: "salary", label: "Фикс. ставка" },
                      { id: "hour", label: "Почасовая" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setScheme(opt.id)}
                        style={{
                          flex: 1, height: 36, borderRadius: 8,
                          border: `1.5px solid ${scheme === opt.id ? T3.navy : T3.border}`,
                          background: scheme === opt.id ? T3.navy : T3.card,
                          color: scheme === opt.id ? "white" : T3.text,
                          fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {scheme === "percent" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 42, borderRadius: 9, border: `1.5px solid ${T3.yellowDeep}`, background: T3.yellow }}>
                      <input
                        value={percentVal}
                        onChange={(e) => setPercentVal(e.target.value)}
                        className="num"
                        style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 18, fontWeight: 700, color: T3.navy, fontFamily: T3.fontMono }}
                      />
                      <span className="num" style={{ fontSize: 18, fontWeight: 700, color: T3.navy }}>%</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Add another card */}
            <div style={{ background: "transparent", borderRadius: 14, border: `2px dashed ${T3.borderStrong}`, padding: 18, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 170, cursor: "pointer", color: T3.textMuted }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: T3.card, border: `1.5px solid ${T3.borderStrong}`, display: "grid", placeItems: "center", marginBottom: 8 }}>
                <Icon3 name="plus" size={18} color={T3.textMuted} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Добавить мастера</div>
            </div>

            <div style={{ background: "transparent", borderRadius: 14, border: `2px dashed ${T3.borderStrong}`, padding: 18, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 170, cursor: "pointer", color: T3.textMuted }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: T3.card, border: `1.5px solid ${T3.borderStrong}`, display: "grid", placeItems: "center", marginBottom: 8 }}>
                <Icon3 name="plus" size={18} color={T3.textMuted} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Добавить мастера</div>
            </div>
          </div>

          {/* Footer actions */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 30, paddingTop: 22, borderTop: `1px solid ${T3.border}` }}>
            <a style={{ fontSize: 13, color: T3.textMuted, cursor: "pointer", fontWeight: 500 }}>
              ← Назад
            </a>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <a style={{ fontSize: 13, color: T3.textMuted, cursor: "pointer", fontWeight: 500 }}>
                Пропустить — добавлю потом
              </a>
              <button style={{
                height: 46, padding: "0 24px", borderRadius: 11,
                background: T3.navy, color: "white", border: "none",
                fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 7,
                boxShadow: "0 4px 10px rgba(26,26,46,0.18)",
              }}>
                Продолжить
                <Icon3 name="arrow-right" size={15} color="white" strokeWidth={2.4} />
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

/* ---------------- MOBILE DASHBOARD (Screen 6) ---------------- */
const MobileDashboard = () => {
  return (
    <div style={{ width: 390, height: 844, background: T3.bg, borderRadius: 38, border: `8px solid #1A1A2E`, overflow: "hidden", position: "relative", boxShadow: T3.shadowXl, fontFamily: T3.fontSans }}>
      {/* Status bar */}
      <div style={{ height: 44, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, fontWeight: 600, color: T3.text, background: T3.bg }}>
        <span className="num">9:41</span>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <span style={{ fontSize: 11 }}>●●●●</span>
          <span style={{ fontSize: 11 }}>📶</span>
          <span style={{ width: 22, height: 11, border: `1.5px solid ${T3.text}`, borderRadius: 3, position: "relative" }}>
            <span style={{ position: "absolute", inset: "1px", background: T3.text, borderRadius: 1, width: "80%" }} />
          </span>
        </div>
      </div>

      {/* Top bar */}
      <div style={{ padding: "8px 20px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, color: T3.textMuted, fontWeight: 500 }}>понедельник, 6 мая</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T3.navy, letterSpacing: "-0.02em" }}>Salon Vivienne</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ width: 38, height: 38, borderRadius: 10, border: `1px solid ${T3.border}`, background: T3.card, display: "grid", placeItems: "center", position: "relative" }}>
            <Icon3 name="bell" size={17} color={T3.text} />
            <span style={{ position: "absolute", top: 8, right: 9, width: 7, height: 7, borderRadius: "50%", background: T3.red, border: `1.5px solid ${T3.card}` }} />
          </button>
        </div>
      </div>

      {/* Period pills */}
      <div style={{ padding: "0 20px 14px" }}>
        <div style={{ display: "flex", background: T3.card, border: `1px solid ${T3.border}`, borderRadius: 999, padding: 3 }}>
          {["День", "Неделя", "Месяц"].map((p, i) => (
            <button key={p} style={{
              flex: 1, padding: "8px 0", borderRadius: 999, border: "none",
              background: i === 2 ? T3.navy : "transparent",
              color: i === 2 ? "white" : T3.textMuted,
              fontSize: 13, fontWeight: 600, fontFamily: "inherit",
            }}>{p}</button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="scrollbar-thin" style={{ height: "calc(100% - 44px - 64px - 56px - 84px)", overflow: "auto", padding: "0 20px 20px" }}>
        {/* PROFIT card first */}
        <div style={{ background: T3.navy, borderRadius: 16, padding: "20px 22px", marginBottom: 12, position: "relative", overflow: "hidden", boxShadow: T3.shadowMd }}>
          <div style={{ position: "absolute", top: -30, right: -30, width: 130, height: 130, borderRadius: "50%", background: "radial-gradient(circle, rgba(46,158,107,0.22) 0%, transparent 70%)" }} />
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.65)", textTransform: "uppercase", marginBottom: 8 }}>
            Прибыль
          </div>
          <div className="num" style={{ fontSize: 40, fontWeight: 700, color: "white", letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 10 }}>
            €1 635
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>чистыми в кармане</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 999, background: "rgba(46,158,107,0.22)", color: "#7ED9A8", fontSize: 10, fontWeight: 700 }}>
              ↑ +12%
            </span>
          </div>
        </div>

        {/* Revenue + Expense stacked */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div style={{ background: T3.card, border: `1px solid ${T3.border}`, borderRadius: 14, padding: "14px 14px" }}>
            <div style={{ fontSize: 11, color: T3.textMuted, fontWeight: 600, marginBottom: 4 }}>Выручка</div>
            <div className="num" style={{ fontSize: 22, fontWeight: 700, color: T3.sage, letterSpacing: "-0.02em" }}>€2 840</div>
          </div>
          <div style={{ background: T3.card, border: `1px solid ${T3.border}`, borderRadius: 14, padding: "14px 14px" }}>
            <div style={{ fontSize: 11, color: T3.textMuted, fontWeight: 600, marginBottom: 4 }}>Расходы</div>
            <div className="num" style={{ fontSize: 22, fontWeight: 700, color: T3.red, letterSpacing: "-0.02em" }}>–€1 205</div>
          </div>
        </div>

        {/* Mini bars */}
        <div style={{ background: T3.card, border: `1px solid ${T3.border}`, borderRadius: 14, padding: "16px 16px", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T3.navy, marginBottom: 12 }}>Выручка по мастерам</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {[
              { n: "Аня", v: 1240, max: 1240 },
              { n: "Катя", v: 980, max: 1240 },
              { n: "Марина", v: 420, max: 1240 },
              { n: "Оля", v: 200, max: 1240 },
            ].map((m, i) => (
              <div key={m.n} style={{ display: "grid", gridTemplateColumns: "60px 1fr 60px", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: T3.text, fontWeight: 500 }}>{m.n}</span>
                <div style={{ height: 8, background: T3.bg, borderRadius: 999 }}>
                  <div style={{ width: `${(m.v / m.max) * 100}%`, height: "100%", background: T3.teal, borderRadius: 999 }} />
                </div>
                <span className="num" style={{ fontSize: 12, fontWeight: 700, color: T3.navy, textAlign: "right" }}>€{fmt3(m.v)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent compact */}
        <div style={{ background: T3.card, border: `1px solid ${T3.border}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px 8px", fontSize: 13, fontWeight: 700, color: T3.navy }}>Сегодня</div>
          {[
            { m: "Аня", s: "Маникюр гель", a: 40, c: "#F4D7C5" },
            { m: "Катя", s: "Ламинирование бровей", a: 45, c: "#D7E4C5" },
          ].map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderTop: `1px solid ${T3.border}` }}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", background: r.c, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, color: T3.navy }}>{r.m[0]}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T3.text }}>{r.s}</div>
                <div style={{ fontSize: 11, color: T3.textMuted }}>{r.m}</div>
              </div>
              <span className="num" style={{ fontSize: 14, fontWeight: 700, color: T3.sage }}>+€{r.a}</span>
            </div>
          ))}
        </div>
      </div>

      {/* FAB */}
      <button style={{
        position: "absolute", bottom: 100, right: 20, width: 60, height: 60, borderRadius: "50%",
        background: T3.navy, border: "none", display: "grid", placeItems: "center", cursor: "pointer",
        boxShadow: "0 6px 14px rgba(26,26,46,0.32), 0 18px 32px rgba(26,26,46,0.22)", zIndex: 5,
      }}>
        <Icon3 name="plus" size={26} color="white" strokeWidth={2.4} />
      </button>

      {/* Bottom tab bar */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: 84,
        background: T3.card, borderTop: `1px solid ${T3.border}`,
        display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
        paddingBottom: 22,
      }}>
        {[
          { i: "home", l: "Главная", a: true },
          { i: "calendar", l: "Визиты" },
          { i: "expense", l: "Расходы" },
          { i: "robot", l: "AI" },
          { i: "settings", l: "Ещё" },
        ].map((t) => (
          <div key={t.l} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, color: t.a ? T3.navy : T3.textFaint }}>
            <Icon3 name={t.i} size={20} color={t.a ? T3.navy : T3.textFaint} />
            <span style={{ fontSize: 10, fontWeight: t.a ? 700 : 500 }}>{t.l}</span>
          </div>
        ))}
      </div>

      {/* Home indicator */}
      <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", width: 130, height: 4, borderRadius: 999, background: T3.text, opacity: 0.85 }} />
    </div>
  );
};

window.AIScreen = AIScreen;
window.OnboardingScreen = OnboardingScreen;
window.MobileDashboard = MobileDashboard;
