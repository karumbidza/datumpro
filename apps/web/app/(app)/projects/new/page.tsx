import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { NewProjectForm } from './new-project-form';
import { Card } from '@/components/ui/card';

export default async function NewProjectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <Link href="/projects" className="text-xs text-zinc-500 hover:underline">
        ← Projects
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New project</h1>

      <Card className="mt-6">
        <NewProjectForm />
      </Card>
    </main>
  );
}
