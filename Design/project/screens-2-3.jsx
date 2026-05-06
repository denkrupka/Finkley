/* FinSalon — Quick Entry Modal, Expenses, AI, Onboarding, Mobile */
const T2 = window.TOKENS;
const Icon2 = window.Icon;
const fmt2 = window.fmt;
const Card2 = window.Card;
const PayPill2 = window.PayPill;

/* ---------------- QUICK ENTRY MODAL (Screen 2) ---------------- */
const QuickEntryModal = ({ open, onClose, embedded = false }) => {
  const [pay, setPay] = React.useState("Карта");
  const [master, setMaster] = React.useState("Аня");
  const [service, setService] = React.useState("Маникюр гель");
  const [amount, setAmount] = React.useState("40");
  const [comment, setComment] = React.useState("");
  if (!open && !embedded) return null;

  const Field = ({ label, children }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T2.textMuted, letterSpacing: "0.02em" }}>
        {label}
      </label>
      {children}
    </div>
  );

  const inputBase = {
    height: 48,
    borderRadius: 10,
    border: `1.5px solid ${T2.border}`,
    background: T2.card,
    fontSize: 15,
    fontFamily: "inherit",
    color: T2.text,
    padding: "0 14px",
    outline: "none",
    width: "100%",
    transition: "border-color 0.15s, background 0.15s",
  };

  const masters = ["Аня", "Катя", "Марина", "Оля"];
  const masterColor = ["#F4D7C5","#D7E4C5","#C5DAE4","#E4C5DC"][masters.indexOf(master)];

  const card = (
    <div
      style={{
        width: 420,
        background: T2.card,
        borderRadius: 18,
        boxShadow: T2.shadowXl,
        padding: 0,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 22px 16px",
          borderBottom: `1px solid ${T2.border}`,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: T2.navy, letterSpacing: "-0.01em" }}>
            Новый визит
          </div>
          <div style={{ fontSize: 12, color: T2.textMuted, marginTop: 2 }}>
            Запишется в книгу за пару секунд
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            border: `1px solid ${T2.border}`,
            background: T2.card,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
          }}
        >
          <Icon2 name="close" size={16} color={T2.text} />
        </button>
      </div>

      {/* Form */}
      <div style={{ padding: "20px 22px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Дата">
          <div style={{ ...inputBase, display: "flex", alignItems: "center", gap: 10 }}>
            <Icon2 name="calendar" size={17} color={T2.textMuted} />
            <span className="num" style={{ fontWeight: 500 }}>6 мая 2026, понедельник</span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: T2.sage, fontWeight: 700, background: T2.sageSoft, padding: "2px 7px", borderRadius: 999 }}>
              сегодня
            </span>
          </div>
        </Field>

        <Field label="Мастер">
          <div style={{ ...inputBase, display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: masterColor,
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                fontWeight: 700,
                color: T2.navy,
              }}
            >
              {master[0]}
            </span>
            <span style={{ fontWeight: 500 }}>{master}</span>
            <Icon2 name="chevron-down" size={15} color={T2.textMuted} style={{ marginLeft: "auto" }} />
          </div>
        </Field>

        <Field label="Услуга">
          <div style={{ ...inputBase, display: "flex", alignItems: "center", gap: 10 }}>
            <Icon2 name="search" size={15} color={T2.textMuted} />
            <span style={{ fontWeight: 500, flex: 1 }}>{service}</span>
            <span className="num" style={{ fontSize: 13, color: T2.textMuted }}>≈ €40</span>
            <Icon2 name="chevron-down" size={15} color={T2.textMuted} />
          </div>
        </Field>

        <Field label="Сумма">
          <div
            style={{
              ...inputBase,
              background: T2.yellow,
              borderColor: T2.yellowDeep,
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 64,
              padding: "0 18px",
            }}
          >
            <span className="num" style={{ fontSize: 28, fontWeight: 700, color: T2.navy }}>€</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="num"
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 32,
                fontWeight: 700,
                color: T2.navy,
                flex: 1,
                fontFamily: T2.fontMono,
                letterSpacing: "-0.02em",
                width: "100%",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            {["Наличные", "Карта", "Перевод"].map((p) => {
              const active = pay === p;
              const ic = p === "Наличные" ? "cash" : p === "Карта" ? "card" : "transfer";
              return (
                <button
                  key={p}
                  onClick={() => setPay(p)}
                  style={{
                    flex: 1,
                    height: 42,
                    borderRadius: 999,
                    border: active ? "none" : `1.5px solid ${T2.border}`,
                    background: active ? T2.navy : T2.card,
                    color: active ? "white" : T2.text,
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <Icon2 name={ic} size={14} color={active ? "white" : T2.textMuted} />
                  {p}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Комментарий (необязательно)">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Например: новая клиентка, по рекомендации"
            style={{ ...inputBase, height: 42, fontSize: 13 }}
          />
        </Field>
      </div>

      {/* Footer */}
      <div style={{ padding: "0 22px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
        <button
          style={{
            height: 52,
            borderRadius: 12,
            background: T2.navy,
            color: "white",
            border: "none",
            fontSize: 15,
            fontWeight: 700,
            fontFamily: "inherit",
            cursor: "pointer",
            boxShadow: "0 6px 14px rgba(26,26,46,0.18)",
          }}
        >
          Сохранить визит
        </button>
        <a
          style={{
            textAlign: "center",
            fontSize: 13,
            color: T2.teal,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Сохранить и добавить ещё
        </a>
      </div>
    </div>
  );

  if (embedded) return card;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(20,20,40,0.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{card}</div>
    </div>
  );
};

/* ---------------- EXPENSES (Screen 3) ---------------- */
const EXPENSE_CATS = [
  { id: "rent", name: "Аренда", icon: "rent", color: "#A678D9", value: 1200 },
  { id: "salary", name: "Зарплата", icon: "salary", color: "#1E6B8A", value: 3400 },
  { id: "materials", name: "Материалы", icon: "materials", color: "#D97757", value: 890 },
  { id: "ads", name: "Реклама", icon: "ads", color: "#2E9E6B", value: 320 },
];

const EXPENSE_LIST = [
  { date: "06.05", cat: "materials", name: "OPI базовое покрытие x4", amount: 84 },
  { date: "05.05", cat: "salary", name: "Аванс — Аня", amount: 400 },
  { date: "04.05", cat: "ads", name: "Instagram реклама", amount: 120 },
  { date: "03.05", cat: "materials", name: "Краска Wella 6/0 x6", amount: 156 },
  { date: "01.05", cat: "rent", name: "Аренда салона — май", amount: 1200 },
  { date: "30.04", cat: "salary", name: "Расчёт — Катя", amount: 720 },
  { date: "28.04", cat: "materials", name: "Стерилизация инструментов", amount: 45 },
  { date: "26.04", cat: "ads", name: "Booksy продвижение", amount: 80 },
];

const ExpensesScreen = ({ period, onPeriod, onAddVisit, onAddExpense }) => {
  const totalCats = EXPENSE_CATS.reduce((s, c) => s + c.value, 0);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: T2.bg }}>
      <window.TopBar period={period} onPeriod={onPeriod} />
      <main className="scrollbar-thin" style={{ flex: 1, overflow: "auto", padding: "28px 32px 80px" }}>
        {/* Page header */}
        <div style={{ marginBottom: 22, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: T2.navy, margin: 0, letterSpacing: "-0.02em" }}>
              Расходы
            </h1>
            <div style={{ fontSize: 14, color: T2.textMuted, marginTop: 4 }}>
              Май 2026 · всего <span className="num" style={{ fontWeight: 700, color: T2.red }}>€{fmt2(totalCats + 90 + 156 + 84 + 45 + 80)}</span>
            </div>
          </div>
          <button
            onClick={onAddExpense}
            style={{
              height: 42,
              padding: "0 18px",
              borderRadius: 10,
              background: T2.teal,
              color: "white",
              border: "none",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              boxShadow: "0 2px 6px rgba(30,107,138,0.22)",
            }}
          >
            <Icon2 name="plus" size={16} color="white" strokeWidth={2.4} />
            Добавить расход
          </button>
        </div>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 22 }}>
          {EXPENSE_CATS.map((c) => (
            <div
              key={c.id}
              style={{
                background: T2.card,
                borderRadius: 12,
                border: `1px solid ${T2.border}`,
                borderLeft: `4px solid ${c.color}`,
                padding: "16px 18px",
                boxShadow: T2.shadowSm,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Icon2 name={c.icon} size={15} color={c.color} />
                <span style={{ fontSize: 12, fontWeight: 600, color: T2.textMuted }}>{c.name}</span>
              </div>
              <div className="num" style={{ fontSize: 22, fontWeight: 700, color: T2.text, letterSpacing: "-0.02em" }}>
                €{fmt2(c.value)}
              </div>
            </div>
          ))}
        </div>

        {/* Two-column main */}
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 18 }}>
          {/* Expenses list */}
          <Card2 padding={0}>
            <div style={{ padding: "18px 22px 14px", display: "flex", alignItems: "baseline", justifyContent: "space-between", borderBottom: `1px solid ${T2.border}` }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: T2.navy, margin: 0, letterSpacing: "-0.01em" }}>
                Все расходы
              </h3>
              <span style={{ fontSize: 12, color: T2.textMuted }}>{EXPENSE_LIST.length} записей</span>
            </div>
            <div>
              {EXPENSE_LIST.map((e, i) => {
                const cat = EXPENSE_CATS.find((c) => c.id === e.cat);
                return (
                  <div
                    key={i}
                    className="exp-row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "60px 32px 1fr 100px 56px",
                      alignItems: "center",
                      padding: "12px 22px",
                      borderTop: i === 0 ? "none" : `1px solid ${T2.border}`,
                      borderLeft: `3px solid ${cat.color}`,
                      gap: 12,
                      cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = T2.bg)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div className="num" style={{ fontSize: 12, color: T2.textMuted }}>{e.date}</div>
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        background: cat.color + "18",
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <Icon2 name={cat.icon} size={15} color={cat.color} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: T2.text }}>{e.name}</div>
                      <div style={{ fontSize: 11, color: T2.textFaint }}>{cat.name}</div>
                    </div>
                    <div className="num" style={{ textAlign: "right", fontWeight: 700, color: T2.red, fontSize: 14 }}>
                      –€{fmt2(e.amount)}
                    </div>
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      <button style={{ width: 26, height: 26, borderRadius: 7, border: `1px solid ${T2.border}`, background: T2.card, display: "grid", placeItems: "center", cursor: "pointer" }}>
                        <Icon2 name="edit" size={12} color={T2.textMuted} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card2>

          {/* Right: structure + AI insight */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card2>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: T2.navy, margin: "0 0 16px", letterSpacing: "-0.01em" }}>
                Структура расходов
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {EXPENSE_CATS.map((c) => {
                  const pct = (c.value / totalCats) * 100;
                  return (
                    <div key={c.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 13, color: T2.text, fontWeight: 500 }}>{c.name}</span>
                        <span className="num" style={{ fontSize: 13, fontWeight: 700, color: T2.navy }}>
                          €{fmt2(c.value)} <span style={{ color: T2.textFaint, fontWeight: 500 }}>· {Math.round(pct)}%</span>
                        </span>
                      </div>
                      <div style={{ height: 10, background: T2.bg, borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: c.color, borderRadius: 999 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card2>

            {/* AI insight */}
            <div
              style={{
                background: "linear-gradient(135deg, #FFFCEB 0%, #FFF6CC 100%)",
                borderRadius: 14,
                borderLeft: `4px solid ${T2.teal}`,
                padding: "16px 18px",
                display: "flex",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  background: T2.teal,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <Icon2 name="robot" size={16} color="white" />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: T2.teal, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                  AI-подсказка
                </div>
                <div style={{ fontSize: 13.5, color: T2.text, lineHeight: 1.5, fontStyle: "italic" }}>
                  Материалы растут: <strong style={{ fontStyle: "normal", color: T2.red }}>+23%</strong> к прошлому месяцу. 
                  Похоже, цена на краску Wella выросла. Стоит пересмотреть прайс на окрашивание.
                </div>
                <a style={{ fontSize: 12, color: T2.teal, fontWeight: 700, marginTop: 8, display: "inline-block", cursor: "pointer" }}>
                  Разобрать в чате →
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
      <window.FAB onClick={onAddVisit} />
    </div>
  );
};

window.QuickEntryModal = QuickEntryModal;
window.ExpensesScreen = ExpensesScreen;
