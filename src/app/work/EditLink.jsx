import Link from 'next/link'

// Dev-only shortcut into the work studio, same gate as the tierlist editor.
export default function EditLink() {
  return (
    <Link
      href="/~studio/work"
      className="border-line text-ink text-ui-lg squircle-pill ease-out-quart hover:bg-surface-sunken shrink-0 border px-4 py-2 transition-colors duration-300"
    >
      Edit
    </Link>
  )
}
