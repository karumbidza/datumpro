'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useCombobox } from 'downshift';
import { createProject, createClientAction } from '../actions';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { FormError } from '@/components/ui/form-error';
import { parseDate, formatLongDate } from '@/lib/date';
import {
  CONSTRUCTION_TYPES,
  CONSTRUCTION_TYPE_LABELS,
  CURRENCIES,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
} from '@datumpro/shared/domain';
import type { ClientOption } from '@/lib/data/clients';
import type { CalendarOption } from '@/lib/data/calendars';
import type { UnlinkedBoqOption } from '@/lib/data/boq';
import { inputClass, labelClass } from '@/components/ui/form';

type Member = { userId: string; name: string };
type NewItem = { id: '__new'; name: string };
type Item = ClientOption | NewItem;
const isNew = (i: Item): i is NewItem => i.id === '__new';

const STEPS = [
  { n: 1, title: 'Project Basics' },
  { n: 2, title: 'Schedule & Financials' },
  { n: 3, title: 'Team & Access' },
] as const;

const TIPS: Record<number, string> = {
  1: 'Name it something the team recognises; you can add the description and client now or refine later.',
  2: 'Set realistic timelines and a standard work calendar for consistency. Contract value is optional and can be added later.',
  3: 'Add teammates as contributors now, or manage access from the project later — the manager and you are added automatically.',
};

export function NewProjectForm({
  clients: initialClients,
  calendars,
  members,
  teamOptions,
  currentUserId,
  defaultCalendarId,
  boqs,
}: {
  clients: ClientOption[];
  calendars: CalendarOption[];
  members: Member[];
  teamOptions: Member[];
  currentUserId: string;
  defaultCalendarId: string;
  boqs: UnlinkedBoqOption[];
}) {
  const [state, formAction] = useActionState(createProject, {});
  const supabase = useMemo(() => createClient(), []);

  // Wizard step (1–3).
  const [step, setStep] = useState(1);

  // Controlled fields (submitted via hidden inputs where not native form controls).
  const [name, setName] = useState('');
  const [clients, setClients] = useState<ClientOption[]>(initialClients);
  const [selectedClient, setSelectedClient] = useState<ClientOption | null>(null);
  const [filter, setFilter] = useState('');
  const [constructionType, setConstructionType] = useState<string>('new_build');
  const [managerId, setManagerId] = useState(currentUserId);
  const [startDate, setStartDate] = useState('');
  const [durationValue, setDurationValue] = useState('');
  const [durationUnit, setDurationUnit] = useState<'weeks' | 'days'>('weeks');
  const [calendarId, setCalendarId] = useState(defaultCalendarId);
  const [currency, setCurrency] = useState<string>('USD');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [boqMode, setBoqMode] = useState<'none' | 'existing' | 'create'>('none');
  const [boqId, setBoqId] = useState('');

  // Inline "New client" sub-form.
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newBusy, setNewBusy] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  // Live derived end date from the DB's add_working_days (one source of truth).
  const [preview, setPreview] = useState<{ endDate: string; workingDays: number } | null>(null);

  const selectedCalendar = calendars.find((c) => c.id === calendarId) ?? null;

  const step1Valid = name.trim().length > 0 && !!selectedClient;
  // Gate the "existing BOQ" bill too — its select is `required` and lives on this
  // (hidden-on-step-3) step, so leaving it empty would throw a "not focusable"
  // error at submit rather than a visible validation message.
  const step2Valid = !!startDate && Number(durationValue) > 0 && (boqMode !== 'existing' || !!boqId);
  const currentStepValid = step === 1 ? step1Valid : step === 2 ? step2Valid : true;

  const filteredClients = filter
    ? clients.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()))
    : clients;
  const items: Item[] = [
    ...filteredClients,
    { id: '__new', name: filter.trim() ? `＋ New client “${filter.trim()}”` : '＋ New client' },
  ];

  const combobox = useCombobox<Item>({
    items,
    selectedItem: selectedClient,
    itemToString: (i) => (i && !isNew(i) ? i.name : ''),
    onInputValueChange: ({ inputValue }) => setFilter(inputValue ?? ''),
    onSelectedItemChange: ({ selectedItem }) => {
      if (!selectedItem) return;
      if (isNew(selectedItem)) {
        setNewName(filter.trim());
        setNewError(null);
        setNewOpen(true);
        return;
      }
      setSelectedClient(selectedItem);
    },
  });

  useEffect(() => {
    const days = Number(durationValue);
    if (!startDate || !days || days <= 0 || !selectedCalendar) {
      setPreview(null);
      return;
    }
    const workingDays = durationUnit === 'weeks' ? days * selectedCalendar.workingDaysPerWeek : days;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('add_working_days', {
        p_start: startDate,
        p_days: workingDays,
        p_calendar: calendarId,
      });
      if (!error && typeof data === 'string') setPreview({ endDate: data, workingDays });
      else setPreview(null);
    }, 300);
    return () => clearTimeout(t);
  }, [startDate, durationValue, durationUnit, calendarId, selectedCalendar, supabase]);

  async function saveNewClient() {
    if (newName.trim().length < 2) {
      setNewError('Enter a client name.');
      return;
    }
    setNewBusy(true);
    setNewError(null);
    const res = await createClientAction({ name: newName.trim(), email: newEmail.trim(), phone: newPhone.trim() });
    setNewBusy(false);
    if (res.error || !res.client) {
      setNewError(res.error ?? 'Could not create client.');
      return;
    }
    const created: ClientOption = { id: res.client.id, name: res.client.name, email: newEmail.trim() || null, phone: newPhone.trim() || null };
    setClients((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedClient(created);
    combobox.setInputValue(created.name);
    setNewOpen(false);
    setNewEmail('');
    setNewPhone('');
  }

  return (
    <div className="lg:grid lg:grid-cols-[190px_1fr_230px] lg:gap-8">
      {/* Stepper */}
      <nav aria-label="Progress" className="mb-6 lg:mb-0">
        <ol className="flex gap-4 lg:flex-col lg:gap-0">
          {STEPS.map((s, i) => {
            const isCurrent = step === s.n;
            const isDone = step > s.n;
            const reachable = s.n <= step;
            return (
              <li key={s.n} className="lg:relative lg:pb-6 lg:last:pb-0">
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className={`hidden lg:block lg:absolute lg:left-[13px] lg:top-7 lg:bottom-1 lg:w-px ${
                      isDone ? 'bg-brand-600' : 'bg-zinc-200 dark:bg-zinc-800'
                    }`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => reachable && setStep(s.n)}
                  disabled={!reachable}
                  className={`flex items-center gap-2.5 text-left lg:w-full ${
                    reachable ? 'cursor-pointer' : 'cursor-default'
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      isCurrent
                        ? 'bg-brand-600 text-white'
                        : isDone
                          ? 'bg-brand-600/15 text-brand-600 dark:text-brand-500'
                          : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}
                  >
                    {isDone ? '✓' : s.n}
                  </span>
                  <span
                    className={`text-sm ${
                      isCurrent
                        ? 'font-medium text-brand-600 dark:text-brand-500'
                        : isDone
                          ? 'text-zinc-700 dark:text-zinc-300'
                          : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    <span className="hidden sm:inline">{s.n}. </span>
                    {s.title}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Form */}
      <form action={formAction} className="space-y-4">
        <FormError error={state.error} />

        {/* Step 1 — Project Basics */}
        <div className={step === 1 ? 'space-y-4' : 'hidden'}>
          {/* Name */}
          <div>
            <label className={labelClass}>Project name</label>
            <input
              name="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Riverside Office Block"
              className={inputClass}
            />
          </div>

          {/* Description */}
          <div>
            <label className={labelClass}>
              Description <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
            </label>
            <textarea
              name="description"
              rows={3}
              maxLength={2000}
              placeholder="Scope, siting, anything the team should know up front…"
              className={inputClass}
            />
          </div>

          {/* Code (auto) */}
          <div>
            <label className={labelClass}>Project code</label>
            <input
              readOnly
              value="Assigned on save · DP-YYYY-###"
              className={`${inputClass} cursor-not-allowed text-zinc-500 dark:text-zinc-400`}
              tabIndex={-1}
            />
          </div>

          {/* Client — searchable + inline new */}
          <div>
            <label className={labelClass} {...combobox.getLabelProps()}>
              Client
            </label>
            <div className="relative">
              <input
                {...combobox.getInputProps()}
                placeholder="Search or add a client…"
                className={inputClass}
              />
              <input type="hidden" name="clientId" value={selectedClient?.id ?? ''} />
              <ul
                {...combobox.getMenuProps()}
                className={`absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${
                  combobox.isOpen ? '' : 'hidden'
                }`}
              >
                {combobox.isOpen &&
                  items.map((item, index) => (
                    <li
                      key={item.id}
                      {...combobox.getItemProps({ item, index })}
                      className={`cursor-pointer px-3 py-2 text-sm ${
                        combobox.highlightedIndex === index ? 'bg-zinc-100 dark:bg-zinc-800' : ''
                      } ${isNew(item) ? 'font-medium text-brand-600 dark:text-brand-500' : ''}`}
                    >
                      {item.name}
                    </li>
                  ))}
              </ul>
            </div>
            {selectedClient && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Selected: {selectedClient.name}</p>
            )}
          </div>

          {/* Inline new-client sub-form */}
          {newOpen && (
            <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">New client</p>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Client name" className={inputClass} />
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email (optional)" className={inputClass} />
              <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone (optional)" className={inputClass} />
              <FormError error={newError} />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={saveNewClient} disabled={newBusy}>
                  {newBusy ? 'Saving…' : 'Save client'}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setNewOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Project type + manager */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Project type</label>
              <select
                name="constructionType"
                required
                value={constructionType}
                onChange={(e) => setConstructionType(e.target.value)}
                className={inputClass}
              >
                {CONSTRUCTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CONSTRUCTION_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Project manager</label>
              <select name="managerId" value={managerId} onChange={(e) => setManagerId(e.target.value)} className={inputClass}>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                    {m.userId === currentUserId ? ' (you)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Step 2 — Schedule & Financials */}
        <div className={step === 2 ? 'space-y-4' : 'hidden'}>
          {/* Priority */}
          <div>
            <label className={labelClass}>Priority</label>
            <select name="priority" defaultValue="medium" className={inputClass}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          {/* Start date + duration, live end-date helper under the row */}
          <div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Start date</label>
                <input
                  type="date"
                  name="startDate"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Duration</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    name="durationValue"
                    min={1}
                    value={durationValue}
                    onChange={(e) => setDurationValue(e.target.value)}
                    required
                    className={`${inputClass} min-w-0`}
                  />
                  <div className="flex shrink-0 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
                    {(['weeks', 'days'] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setDurationUnit(u)}
                        className={`px-3 text-sm capitalize ${
                          durationUnit === u
                            ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                            : 'text-zinc-500 dark:text-zinc-400'
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                  <input type="hidden" name="durationUnit" value={durationUnit} />
                </div>
              </div>
            </div>
            {preview && selectedCalendar && (
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                Ends {formatLongDate(parseDate(preview.endDate) ?? new Date())} · {preview.workingDays} working days ·{' '}
                {selectedCalendar.name}
              </p>
            )}
          </div>

          {/* Work calendar */}
          <div>
            <label className={labelClass}>Work calendar</label>
            <select name="calendarId" value={calendarId} onChange={(e) => setCalendarId(e.target.value)} className={inputClass}>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Currency + contract value */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Currency</label>
              <select name="currency" required value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>
                Contract value ({currency}) <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
              </label>
              <input type="number" name="contractValue" min={0} step="0.01" placeholder="0.00" className={inputClass} />
            </div>
          </div>

          {/* Bill of Quantities — none / start from an existing bill / draft one now */}
          <div>
            <label className={labelClass}>Bill of Quantities</label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['none', 'No BOQ'],
                  ['existing', 'Use existing BOQ'],
                  ['create', 'Create BOQ now'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setBoqMode(mode)}
                  disabled={mode === 'existing' && boqs.length === 0}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${
                    boqMode === mode
                      ? 'bg-brand-600 text-white'
                      : 'border border-zinc-300 text-zinc-600 hover:border-brand-400 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input type="hidden" name="boqMode" value={boqMode} />
            {boqMode === 'existing' && (
              <div className="mt-2">
                <select name="boqId" required value={boqId} onChange={(e) => setBoqId(e.target.value)} className={inputClass}>
                  <option value="">Choose a bill…</option>
                  {boqs.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · {b.itemCount} items · {b.currency} {(b.totalCents / 100).toLocaleString()}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Tasks are generated from its sections at your budget rates — unassigned, ready for contractors.
                </p>
              </div>
            )}
            {boqMode === 'create' && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                A draft bill is created with this project&apos;s name, client and currency — you&apos;ll land in the
                builder. Generate tasks from the project&apos;s BOQ tab when the bill is approved.
              </p>
            )}
          </div>

          {/* Template (out of scope to apply yet) */}
          <div>
            <label className={labelClass}>Template</label>
            <select name="templateId" defaultValue="" className={inputClass}>
              <option value="">No templates yet — you can add tasks manually</option>
            </select>
          </div>
        </div>

        {/* Step 3 — Team & Access */}
        <div className={step === 3 ? 'space-y-4' : 'hidden'}>
          {/* Team members — org members picked onto the project at creation */}
          <div>
            <label className={labelClass}>
              Team members <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
            </label>
            <select
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (id && !teamIds.includes(id)) setTeamIds((prev) => [...prev, id]);
              }}
              className={inputClass}
            >
              <option value="">Add team members…</option>
              {teamOptions
                .filter((m) => !teamIds.includes(m.userId) && m.userId !== managerId && m.userId !== currentUserId)
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
            </select>
            {teamIds.map((id) => (
              <input key={id} type="hidden" name="teamMemberIds" value={id} />
            ))}
            {teamIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {teamIds.map((id) => {
                  const m = teamOptions.find((t) => t.userId === id);
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-600 dark:bg-brand-600/15 dark:text-brand-500"
                    >
                      {m?.name ?? 'Member'}
                      <button
                        type="button"
                        aria-label={`Remove ${m?.name ?? 'member'}`}
                        onClick={() => setTeamIds((prev) => prev.filter((x) => x !== id))}
                        className="rounded px-0.5 hover:bg-brand-100 dark:hover:bg-brand-600/25"
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Added as contributors — the manager and you are on the project automatically.
            </p>
          </div>
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between pt-2">
          {step > 1 ? (
            <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {step < 3 ? (
            <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!currentStepValid}>
              Next
            </Button>
          ) : (
            <SubmitButton pendingText="Creating…" disabled={!selectedClient}>
              Create project
            </SubmitButton>
          )}
        </div>
      </form>

      {/* Helpful Tips */}
      <aside className="mt-6 lg:mt-0">
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Helpful Tips</p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{TIPS[step]}</p>
          <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
            <a href="#" className="hover:underline">
              Learn more about project settings
            </a>
          </p>
        </div>
      </aside>
    </div>
  );
}
