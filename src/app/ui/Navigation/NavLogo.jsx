
import Link from "next/link";

export default function NavLogo() {
  return (
    <Link href={"/"} className=" nav__logo">
      {/* logo would go in here */}
      <h1 className="font-extrabold text-2xl">Moises Gante</h1>
    </Link>
  );
}