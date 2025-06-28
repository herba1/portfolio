
import Link from "next/link";

export default function NavLogo() {
  return (
    <Link href={"/"} className=" nav__logo">
      {/* logo would go in here */}
      <h1 className="text-dark">Herbart Hernandez</h1>
    </Link>
  );
}