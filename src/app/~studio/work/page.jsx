import { notFound } from 'next/navigation'
import { isProdView } from '@/lib/viewMode'
import WorkStudio from './WorkStudio'

// The studio writes to the repo, so it only exists in dev — same gate the
// write endpoints use. In a production view the route is simply not there.
export default function WorkStudioPage() {
  if (isProdView()) notFound()
  return <WorkStudio />
}
