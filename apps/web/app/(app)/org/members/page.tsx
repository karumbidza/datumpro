import { redirect } from 'next/navigation';

export default async function OrgMembersPage() {
  redirect('/org?tab=members');
}
