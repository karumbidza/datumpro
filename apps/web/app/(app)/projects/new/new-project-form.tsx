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
import { inputClass, labelClass } from '@/components/ui/form';

type Member = { userId: string; name: string };
type NewItem = { id: '__new'; name: string };
type Item = ClientOption | NewItem;
const isNew = (i: Item): i is NewItem => i.id === '__new';

export function NewProjectForm({
  clients: initialClients,
  calendars,
  members,
  teamOptions,
  currentUserId,
  defaultCalendarId,
}: {
  clients: ClientOption[];
  calendars: CalendarOption[];
  members: Member[];
  teamOptions: Member[];
  currentUserId: string;
  defaultCalendarId: string;
}) {
  const [state, formAction] = useActionState(createProject, {});
  const supabase = useMemo(() => createClient(), []);

  // Controlled fields (submitted via hidden inputs where not native form controls).
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
    <form action={formAction} className="space-y-4">
      <FormError error={state.error} />

      {/* Name */}
      <div>
        <label className={labelClass}>Project name</label>
        <input name="name" required placeholder="e.g. Riverside Office Block" className={inputClass} />
      </div>

      {/* Description */}
      <div>
        <label className={labelClass}>
          Description <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
        </label>
        <textarea
          name="description"
          rows={3}
          maxLength={2000}
          placeholder="Scope, siting, anything the team should know up front…"
          className={inputClass}
        />
      </div>

      {/* Code (auto) + priority */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Project code</label>
          <input
            readOnly
            value="Assigned on save · DP-YYYY-###"
            className={`${inputClass} cursor-not-allowed text-zinc-400 dark:text-zinc-500`}
            tabIndex={-1}
          />
        </div>
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
            Contract value ({currency}) <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
          </label>
          <input type="number" name="contractValue" min={0} step="0.01" placeholder="0.00" className={inputClass} />
        </div>
      </div>

      {/* Team members — org members picked onto the project at creation */}
      <div>
        <label className={labelClass}>
          Team members <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
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
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          Added as contributors — the manager and you are on the project automatically.
        </p>
      </div>

      {/* Template (out of scope to apply yet) */}
      <div>
        <label className={labelClass}>Template</label>
        <select name="templateId" defaultValue="" className={inputClass}>
          <option value="">No templates yet — you can add tasks manually</option>
        </select>
      </div>

      <div className="pt-2">
        <SubmitButton pendingText="Creating…" disabled={!selectedClient}>
          Create project
        </SubmitButton>
      </div>
    </form>
  );
}
