
import Link from "next/link";

export default function NavLogo( className="") {
  return (
    <Link href={"/"} className={`nav__logo ${className}`} >
      {/* logo would go in here */}
      <h1 className=" ">Herbart Hernandez</h1>
    </Link>
  );
}