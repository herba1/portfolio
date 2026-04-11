export function Aside({ children }) {
  return (
    <aside className="text-dark/50 border-dark/8 my-8 border-l-2 pl-5 text-sm leading-relaxed italic [&>p]:m-0">
      {children}
    </aside>
  )
}
