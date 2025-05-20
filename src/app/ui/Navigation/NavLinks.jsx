
import LinkMask from "../LinkMask";
import {LINKS} from "./LINKS";
import NavDropdownLink from "./NavDropdownLink";

export default function NavLinks() {

  const links = LINKS.map((link) => {
    if (link.links) {
      return (
        <NavDropdownLink
          key={link.name}
          link={link.name}
          name={link.name}
          links={link.links}
        ></NavDropdownLink>
      );
    } else {
      return (
        <li key={link.name}>
          <LinkMask text={link.name} href={link.link}></LinkMask>
        </li>
      );
    }
  });
  return (
    <div className=" hidden  nav__links lg:flex text-center items-center">
      <ul className="flex text-lg items-center gap-5 lg:gap-10 ">
        {links}
      </ul>
    </div>
  );
}