import { createClient } from '@/lib/supabase/server';

export interface ClientOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/** Active clients for the org, alphabetical — feeds the create form's picker. RLS
 *  scopes to the org. */
export async function listClients(orgId: string): Promise<ClientOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('clients')
    .select('id, name, email, phone')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('name', { ascending: true });
  return (data ?? []) as ClientOption[];
}
