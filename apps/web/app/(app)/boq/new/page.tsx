import { redirect } from 'next/navigation';

/** Standalone BOQ creation is retired — a bill belongs to a project. Create it
 *  from the project's BOQ tab (or clone another project's bill). */
export default function NewBoqRedirect() {
  redirect('/projects');
}
