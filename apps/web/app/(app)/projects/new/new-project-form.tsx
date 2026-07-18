'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useCombobox } from 'downshift';
import { createProject, createClientAction } from '../actions';
import { createClient } from '@/lib/supabase/client';
import { SubmitButton } from '@/components/ui/submit-button';
import { FormError } from '@/components/ui/form-error';
import { parseDate, formatLongDate } from '@/lib/date';
import {
  CONSTRUCTION_TYPES,
  CONSTRUCTION_TYPE_LABELS,
  CURRENCIES,
} from '@datumpro/shared/domain';
import type { ClientOption } from '@/lib/data/clients';
import type { CalendarOption } from '@/lib/data/calendars';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';
const labelClass = 'mb-1 block text-sm font-medium';

type Member = { userId: string; name: string };
type NewItem = { id: '__new'; name: string };
type Item = ClientOption | NewItem;
const isNew = (i: Item): i is NewItem => i.id === '__new';

export function NewProjectForm({
  clients: initialClients,
  calendars,
  members,
  currentUserId,
  defaultCalendarId,
}: {
  clients: ClientOption[];
  calendars: CalendarOption[];
  members: Member[];
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

      {/* Code (auto) */}
      <div>
        <label className={labelClass}>Project code</label>
        <input
          readOnly
          value="Assigned on save · DP-YYYY-###"
          className={`${inputClass} cursor-not-allowed text-zinc-400 dark:text-zinc-500`}
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
          <p className="mt-1 text-xs text-zinc-500">Selected: {selectedClient.name}</p>
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
            <button
              type="button"
              onClick={saveNewClient}
              disabled={newBusy}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {newBusy ? 'Saving…' : 'Save client'}
            </button>
            <button
              type="button"
              onClick={() => setNewOpen(false)}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Project type (construction work-type) */}
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

      {/* Project manager */}
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

      {/* Start date */}
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

      {/* Duration + unit + live helper */}
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
            className={inputClass}
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
                    : 'text-zinc-500'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
          <input type="hidden" name="durationUnit" value={durationUnit} />
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

      {/* Currency */}
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

      {/* Contract value */}
      <div>
        <label className={labelClass}>Contract value ({currency}) — optional</label>
        <input type="number" name="contractValue" min={0} step="0.01" placeholder="0.00" className={inputClass} />
      </div>

      {/* Template (out of scope to apply yet) */}
      <div>
        <label className={labelClass}>Template</label>
        <select name="templateId" defaultValue="" className={inputClass}>
          <option value="">Start from scratch</option>
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
