import { useState, useCallback, useEffect } from "react";
import {
  updateDraft,
  submitDraft,
  getAgentTariffs,
  createAgentTariff,
  getExecutorTariffs,
  type Draft,
  type AgentTariff,
  type ExecutorTariffOption,
} from "./api";

type Step =
  | "condition"
  | "executor"
  | "car"
  | "tariffs"
  | "branding"
  | "card";

const STEPS: Step[] = ["condition", "executor", "car", "tariffs", "branding", "card"];

function stepIndex(step: Step): number {
  const i = STEPS.indexOf(step);
  return i >= 0 ? i : 0;
}

function nextStep(s: Step): Step | null {
  const i = stepIndex(s) + 1;
  return STEPS[i] ?? null;
}

function prevStep(s: Step): Step | null {
  const i = stepIndex(s) - 1;
  return i < 0 ? null : STEPS[i];
}

export function RegistrationFlow({
  draft,
  setDraft,
  type,
  onClose,
  onSendData,
  onBackToWelcome,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  type: "driver" | "courier";
  onClose: () => void;
  onSendData: (data: string) => void;
  onBackToWelcome?: () => void;
}) {
  const [step, setStep] = useState<Step>(resolveInitialStep(draft));
  const [agentTariffs, setAgentTariffs] = useState<AgentTariff[]>([]);
  const [executorTariffs, setExecutorTariffs] = useState<ExecutorTariffOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      setError(null);
      setLoading(true);
      try {
        const updated = await updateDraft(draft.id, patch);
        setDraft(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка сохранения");
      } finally {
        setLoading(false);
      }
    },
    [draft.id, setDraft]
  );

  const goNext = useCallback(() => {
    const n = nextStep(step);
    if (n) setStep(n);
  }, [step]);

  const goBack = useCallback(() => {
    const p = prevStep(step);
    if (p) setStep(p);
    else if (step === "condition" && onBackToWelcome) onBackToWelcome();
    else onClose();
  }, [step, onClose, onBackToWelcome]);

  if (step === "condition") {
    return (
      <ConditionStep
        draft={draft}
        onSave={save}
        onNext={goNext}
        onBack={goBack}
        loading={loading}
        error={error}
        setAgentTariffs={setAgentTariffs}
      />
    );
  }
  if (step === "executor") {
    return (
      <ExecutorStep
        draft={draft}
        onSave={save}
        onNext={goNext}
        onBack={goBack}
        loading={loading}
        error={error}
      />
    );
  }
  if (step === "car") {
    return (
      <CarStep
        draft={draft}
        onSave={save}
        onNext={goNext}
        onBack={goBack}
        loading={loading}
        error={error}
      />
    );
  }
  if (step === "tariffs") {
    return (
      <TariffsStep
        draft={draft}
        type={type}
        onSave={save}
        onNext={goNext}
        onBack={goBack}
        loading={loading}
        error={error}
        executorTariffs={executorTariffs}
        setExecutorTariffs={setExecutorTariffs}
      />
    );
  }
  if (step === "branding") {
    return (
      <BrandingStep
        draft={draft}
        onSave={save}
        onNext={goNext}
        onBack={goBack}
        loading={loading}
        error={error}
      />
    );
  }
  if (step === "card") {
    return (
      <CardStep
        draft={draft}
        agentTariffs={agentTariffs}
        executorTariffsList={executorTariffs}
        onConfirm={async () => {
          setError(null);
          setLoading(true);
          try {
            const result = await submitDraft(draft.id);
            onSendData(
              JSON.stringify({
                action: "submitted",
                draftId: draft.id,
                message: result.message,
                executorId: result.executorId,
                linkExecutor: result.linkExecutor,
                linkStats: result.linkStats,
              })
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : "Ошибка регистрации");
          } finally {
            setLoading(false);
          }
        }}
        onCorrect={(section) => {
          if (section === "executor") setStep("executor");
          else if (section === "car") setStep("car");
          else if (section === "condition") setStep("condition");
          else if (section === "tariffs") setStep("tariffs");
          else if (section === "branding") setStep("branding");
        }}
        onBack={goBack}
        loading={loading}
        error={error}
      />
    );
  }

  return null;
}

function resolveInitialStep(d: Draft): Step {
  if (!d.selectedTariffId) return "condition";
  if (!d.executor.fio) return "executor";
  if (!d.car.brand) return "car";
  if (!d.executorTariffs?.length) return "tariffs";
  if (d.brandingWrap === undefined) return "branding";
  return "card";
}

function ConditionStep({
  draft: _draft,
  onSave,
  onNext,
  onBack,
  loading,
  error,
  setAgentTariffs,
}: {
  draft: Draft;
  onSave: (p: Record<string, unknown>) => Promise<void>;
  onNext: () => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
  setAgentTariffs: (t: AgentTariff[]) => void;
}) {
  const [mode, setMode] = useState<"choose" | "create" | null>(null);
  const [list, setList] = useState<AgentTariff[]>([]);
  const [createPercent, setCreatePercent] = useState("");

  const loadList = useCallback(async () => {
    try {
      const tariffs = await getAgentTariffs();
      setList(tariffs);
      setAgentTariffs(tariffs);
    } catch {
      setList([]);
    }
  }, [setAgentTariffs]);

  if (mode === null) {
    return (
      <div>
        <h2 className="section-title">Условие работы (комиссия)</h2>
        <button type="button" className="primary" onClick={() => { setMode("choose"); loadList(); }}>
          Выбрать условие работы
        </button>
        <button type="button" className="secondary" onClick={() => setMode("create")}>
          Создать условие работы
        </button>
        <button type="button" className="secondary" onClick={onBack} style={{ marginTop: 16 }}>
          Назад
        </button>
      </div>
    );
  }

  if (mode === "create") {
    const submit = async () => {
      const n = parseInt(createPercent, 10);
      if (isNaN(n) || n < 0 || n > 100) {
        alert("Введите число от 0 до 100");
        return;
      }
      const t = await createAgentTariff(n);
      await onSave({ selectedTariffId: t.id });
      setAgentTariffs([...list, t]);
      onNext();
    };
    return (
      <div>
        <h2 className="section-title">Комиссия агента, %</h2>
        <p>Введите размер комиссии (без знака %), например 3</p>
        <div className="field">
          <label className="label">Комиссия, %</label>
          <input
            type="number"
            min={0}
            max={100}
            value={createPercent}
            onChange={(e) => setCreatePercent(e.target.value)}
            placeholder="3"
          />
        </div>
        {error && <div className="errors">{error}</div>}
        <button type="button" className="primary" onClick={submit} disabled={loading}>
          Сохранить и продолжить
        </button>
        <button type="button" className="secondary" onClick={() => setMode(null)}>Назад</button>
      </div>
    );
  }

  const select = async (id: string) => {
    await onSave({ selectedTariffId: id });
    onNext();
  };

  return (
    <div>
      <h2 className="section-title">Выберите условие работы</h2>
      {list.length === 0 ? (
        <p>Нет сохранённых условий. <button type="button" onClick={() => setMode("create")}>Создать новое</button></p>
      ) : (
        list.map((t) => (
          <button
            key={t.id}
            type="button"
            className="primary"
            style={{ marginBottom: 8 }}
            onClick={() => select(t.id)}
          >
            {t.commissionPercent}%
          </button>
        ))
      )}
      <button type="button" className="secondary" onClick={() => setMode(null)}>Назад</button>
    </div>
  );
}

function ExecutorStep({
  draft,
  onSave,
  onNext,
  onBack,
  loading,
  error,
}: {
  draft: Draft;
  onSave: (p: Record<string, unknown>) => Promise<void>;
  onNext: () => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}) {
  const [fio, setFio] = useState(draft.executor.fio ?? "");
  const [phone, setPhone] = useState(draft.executor.phone ?? "");
  const [experience, setExperience] = useState(draft.executor.experience ?? "");
  const [license, setLicense] = useState(draft.executor.license ?? "");
  const [licenseCountry, setLicenseCountry] = useState(draft.executor.licenseCountry ?? "");
  const [licenseIssueDate, setLicenseIssueDate] = useState(draft.executor.licenseIssueDate ?? "");
  const [licenseValidUntil, setLicenseValidUntil] = useState(draft.executor.licenseValidUntil ?? "");

  const normalizePhone = (v: string) => {
    const d = v.replace(/\D/g, "");
    if (d.length <= 10 && d.startsWith("9")) return "+7" + d;
    if (d.length === 11 && d.startsWith("7")) return "+" + d;
    if (d.length === 11 && d.startsWith("8")) return "+7" + d.slice(1);
    return v.startsWith("+") ? v : "+" + d;
  };

  const submit = async () => {
    if (!fio.trim()) { alert("Введите ФИО"); return; }
    const phoneNorm = normalizePhone(phone);
    if (phoneNorm.length < 11) { alert("Введите корректный телефон"); return; }
    if (!license.trim() || license.replace(/\s/g, "").length < 8) { alert("Серия и номер ВУ без пробелов, не менее 8 символов"); return; }
    const issue = parseDDMMYYYY(licenseIssueDate);
    const valid = parseDDMMYYYY(licenseValidUntil);
    if (!issue) { alert("Дата выдачи ВУ: формат ДД.ММ.ГГГГ"); return; }
    if (!valid || valid <= issue) { alert("Действует до должна быть позже даты выдачи"); return; }
    await onSave({
      executorFio: fio.trim(),
      executorPhone: phoneNorm,
      executorExperience: experience.trim() || undefined,
      executorLicense: license.replace(/\s/g, ""),
      executorLicenseCountry: licenseCountry.trim() || undefined,
      executorLicenseIssueDate: licenseIssueDate.trim() || undefined,
      executorLicenseValidUntil: licenseValidUntil.trim() || undefined,
    });
    onNext();
  };

  return (
    <div>
      <h2 className="section-title">Заполни Карточку исполнителя</h2>
      <div className="field">
        <label className="label">Фамилия, имя, отчество</label>
        <input value={fio} onChange={(e) => setFio(e.target.value)} placeholder="Фамилия Имя Отчество" />
      </div>
      <div className="field">
        <label className="label">Номер тел.</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 999 123 45 67" />
      </div>
      <div className="field">
        <label className="label">Водит. стаж* (дата с оборота В.У., ДД.ММ.ГГГГ)</label>
        <input value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="01.01.2015" />
      </div>
      <div className="field">
        <label className="label">Серия и номер В.У.</label>
        <input value={license} onChange={(e) => setLicense(e.target.value.replace(/\s/g, ""))} placeholder="1234567890" />
      </div>
      <div className="field">
        <label className="label">Страна выдачи В.У.</label>
        <input value={licenseCountry} onChange={(e) => setLicenseCountry(e.target.value)} placeholder="Россия" />
      </div>
      <div className="field">
        <label className="label">Дата выдачи В.У.</label>
        <input value={licenseIssueDate} onChange={(e) => setLicenseIssueDate(e.target.value)} placeholder="01.01.2020" />
      </div>
      <div className="field">
        <label className="label">Действует до</label>
        <input value={licenseValidUntil} onChange={(e) => setLicenseValidUntil(e.target.value)} placeholder="01.01.2030" />
      </div>
      {error && <div className="errors">{error}</div>}
      <button type="button" className="primary" onClick={submit} disabled={loading}>Далее</button>
      <button type="button" className="secondary" onClick={onBack}>Назад</button>
    </div>
  );
}

function CarStep({
  draft,
  onSave,
  onNext,
  onBack,
  loading,
  error,
}: {
  draft: Draft;
  onSave: (p: Record<string, unknown>) => Promise<void>;
  onNext: () => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}) {
  const [brand, setBrand] = useState(draft.car.brand ?? "");
  const [model, setModel] = useState(draft.car.model ?? "");
  const [color, setColor] = useState(draft.car.color ?? "");
  const [year, setYear] = useState(draft.car.year ? String(draft.car.year) : "");
  const [plate, setPlate] = useState(draft.car.plate ?? "");
  const [sts, setSts] = useState(draft.car.sts ?? "");

  const submit = async () => {
    if (!brand.trim()) { alert("Введите марку"); return; }
    if (!model.trim()) { alert("Введите модель"); return; }
    const y = parseInt(year, 10);
    const currentYear = new Date().getFullYear();
    if (isNaN(y) || y < 2000 || y > currentYear + 1) { alert("Год выпуска: 2000–" + (currentYear + 1)); return; }
    const plateNorm = plate.replace(/\s/g, "").toUpperCase();
    if (plateNorm.length < 7 || plateNorm.length > 8) { alert("Госномер: 7–8 знаков без пробелов"); return; }
    if (!sts.trim()) { alert("Введите номер СТС"); return; }
    await onSave({
      carBrand: brand.trim(),
      carModel: model.trim(),
      carColor: color.trim() || undefined,
      carYear: y,
      carPlate: plateNorm,
      carSts: sts.replace(/\s/g, ""),
    });
    onNext();
  };

  return (
    <div>
      <h2 className="section-title">Данные автомобиля</h2>
      <div className="field">
        <label className="label">Марка</label>
        <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Toyota" />
      </div>
      <div className="field">
        <label className="label">Модель</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Camry" />
      </div>
      <div className="field">
        <label className="label">Цвет</label>
        <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Белый" />
      </div>
      <div className="field">
        <label className="label">Год</label>
        <input type="number" min={2000} max={new Date().getFullYear() + 1} value={year} onChange={(e) => setYear(e.target.value)} placeholder="2020" />
      </div>
      <div className="field">
        <label className="label">Госномер</label>
        <input value={plate} onChange={(e) => setPlate(e.target.value.replace(/\s/g, "").toUpperCase())} placeholder="А123БВ77" />
      </div>
      <div className="field">
        <label className="label">Номер СТС</label>
        <input value={sts} onChange={(e) => setSts(e.target.value.replace(/\s/g, ""))} placeholder="1234567890" />
      </div>
      {error && <div className="errors">{error}</div>}
      <button type="button" className="primary" onClick={submit} disabled={loading}>Далее</button>
      <button type="button" className="secondary" onClick={onBack}>Назад</button>
    </div>
  );
}

function TariffsStep({
  draft,
  type,
  onSave,
  onNext,
  onBack,
  loading,
  error,
  setExecutorTariffs,
}: {
  draft: Draft;
  type: "driver" | "courier";
  onSave: (p: Record<string, unknown>) => Promise<void>;
  onNext: () => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
  executorTariffs: ExecutorTariffOption[];
  setExecutorTariffs: (t: ExecutorTariffOption[]) => void;
}) {
  const [options, setOptions] = useState<ExecutorTariffOption[]>([]);
  const [selected, setSelected] = useState<string[]>(draft.executorTariffs ?? []);

  useEffect(() => {
    getExecutorTariffs(type).then((list) => {
      setOptions(list);
      setExecutorTariffs(list);
    });
  }, [type, setExecutorTariffs]);

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
  };

  const submit = async () => {
    if (selected.length === 0) { alert("Выберите хотя бы один тариф"); return; }
    await onSave({ executorTariffs: selected });
    onNext();
  };

  return (
    <div>
      <h2 className="section-title">Тарифы (категории)</h2>
      <p>Выберите один или несколько тарифов и нажмите «Готово».</p>
      {options.map((t) => (
        <label key={t.id} style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={selected.includes(t.id)}
            onChange={() => toggle(t.id)}
          />
          <span style={{ marginLeft: 8 }}>{t.name}</span>
        </label>
      ))}
      {error && <div className="errors">{error}</div>}
      <button type="button" className="primary" onClick={submit} disabled={loading}>Готово</button>
      <button type="button" className="secondary" onClick={onBack}>Назад</button>
    </div>
  );
}

function BrandingStep({
  draft,
  onSave,
  onNext,
  onBack,
  loading,
  error,
}: {
  draft: Draft;
  onSave: (p: Record<string, unknown>) => Promise<void>;
  onNext: () => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}) {
  const [wrap, setWrap] = useState(draft.brandingWrap ?? false);
  const [lightbox, setLightbox] = useState(draft.brandingLightbox ?? false);

  const submit = async () => {
    await onSave({ brandingWrap: wrap, brandingLightbox: lightbox });
    onNext();
  };

  return (
    <div>
      <h2 className="section-title">Бренд</h2>
      <p>Оклейка</p>
      <button type="button" className={wrap ? "primary" : "secondary"} onClick={() => setWrap(true)} style={{ marginRight: 8 }}>Да</button>
      <button type="button" className={!wrap ? "primary" : "secondary"} onClick={() => setWrap(false)}>Нет</button>
      <p style={{ marginTop: 16 }}>Лайт бокс (световой короб)</p>
      <button type="button" className={lightbox ? "primary" : "secondary"} onClick={() => setLightbox(true)} style={{ marginRight: 8 }}>Да</button>
      <button type="button" className={!lightbox ? "primary" : "secondary"} onClick={() => setLightbox(false)}>Нет</button>
      {error && <div className="errors">{error}</div>}
      <button type="button" className="primary" style={{ marginTop: 24 }} onClick={submit} disabled={loading}>Далее</button>
      <button type="button" className="secondary" onClick={onBack}>Назад</button>
    </div>
  );
}

function CardStep({
  draft: cardDraft,
  agentTariffs,
  executorTariffsList,
  onConfirm,
  onCorrect,
  onBack,
  loading,
  error,
}: {
  draft: Draft;
  agentTariffs: AgentTariff[];
  executorTariffsList: ExecutorTariffOption[];
  onConfirm: () => Promise<void>;
  onCorrect: (section: string) => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}) {
  const agentTariff = agentTariffs.find((t) => t.id === cardDraft.selectedTariffId);
  const executorNames = (cardDraft.executorTariffs ?? [])
    .map((id) => executorTariffsList.find((t) => t.id === id)?.name ?? id)
    .join(", ");

  return (
    <div>
      <h2 className="section-title">Проверка «Карточка исполнителя»</h2>
      <div className="card-block">
        <h3>Исполнитель</h3>
        <p><strong>ФИО:</strong> {cardDraft.executor.fio}</p>
        <p><strong>Телефон:</strong> {cardDraft.executor.phone}</p>
        <p><strong>Стаж:</strong> {cardDraft.executor.experience || "—"}</p>
        <p><strong>ВУ:</strong> {cardDraft.executor.license}</p>
        <p><strong>Страна ВУ:</strong> {cardDraft.executor.licenseCountry || "—"}</p>
        <p><strong>Дата выдачи:</strong> {cardDraft.executor.licenseIssueDate}</p>
        <p><strong>Действует до:</strong> {cardDraft.executor.licenseValidUntil}</p>
        <button type="button" className="secondary" onClick={() => onCorrect("executor")}>Изменить</button>
      </div>
      <div className="card-block">
        <h3>Авто</h3>
        <p><strong>Марка, модель:</strong> {cardDraft.car.brand} {cardDraft.car.model}</p>
        <p><strong>Цвет, год:</strong> {cardDraft.car.color} {cardDraft.car.year}</p>
        <p><strong>Госномер:</strong> {cardDraft.car.plate}</p>
        <p><strong>СТС:</strong> {cardDraft.car.sts}</p>
        <button type="button" className="secondary" onClick={() => onCorrect("car")}>Изменить</button>
      </div>
      <div className="card-block">
        <h3>Условие работы</h3>
        <p>{agentTariff ? `Комиссия ${agentTariff.commissionPercent}%` : cardDraft.selectedTariffId}</p>
        <button type="button" className="secondary" onClick={() => onCorrect("condition")}>Изменить</button>
      </div>
      <div className="card-block">
        <h3>Тарифы (категории)</h3>
        <p>{executorNames || "—"}</p>
        <button type="button" className="secondary" onClick={() => onCorrect("tariffs")}>Изменить</button>
      </div>
      <div className="card-block">
        <h3>Бренд</h3>
        <p>Оклейка: {cardDraft.brandingWrap ? "Да" : "Нет"}, Лайтбокс: {cardDraft.brandingLightbox ? "Да" : "Нет"}</p>
        <button type="button" className="secondary" onClick={() => onCorrect("branding")}>Изменить</button>
      </div>
      {error && <div className="errors">{error}</div>}
      <button type="button" className="primary" onClick={onConfirm} disabled={loading}>
        Данные верны — зарегистрировать исполнителя
      </button>
      <button type="button" className="secondary" onClick={onBack}>Назад</button>
    </div>
  );
}

function parseDDMMYYYY(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const y = parseInt(m[3], 10);
  const date = new Date(y, mo, d);
  if (date.getDate() !== d || date.getMonth() !== mo || date.getFullYear() !== y) return null;
  return date;
}
