import { createClient } from '@/lib/supabase/server';

export interface CalendarOption {
  id: string;
  name: string;
  isDefault: boolean;
  /** Count of working days in the calendar's weekly pattern — used to convert a
   *  duration entered in weeks into working days (the stored unit). */
  workingDaysPerWeek: number;
}

export async function listWorkCalendars(orgId: string): Promise<CalendarOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('work_calendars')
    .select('id, name, is_default, works_mon, works_tue, works_wed, works_thu, works_fri, works_sat, works_sun')
    .eq('org_id', orgId)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true });
  return ((data ?? []) as {
    id: string;
    name: string;
    is_default: boolean;
    works_mon: boolean;
    works_tue: boolean;
    works_wed: boolean;
    works_thu: boolean;
    works_fri: boolean;
    works_sat: boolean;
    works_sun: boolean;
  }[]).map((c) => ({
    id: c.id,
    name: c.name,
    isDefault: c.is_default,
    workingDaysPerWeek: [
      c.works_mon,
      c.works_tue,
      c.works_wed,
      c.works_thu,
      c.works_fri,
      c.works_sat,
      c.works_sun,
    ].filter(Boolean).length,
  }));
}
