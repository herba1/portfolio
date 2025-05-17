"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, Menu, Phone, ChevronDown } from "lucide-react";

function NavMenu({ menuIsOpen, setMenuIsOpen, children }) {
  return (
    <menu
      className={` ${
        menuIsOpen ? " grid " : " hidden "
      } nav__menu__container transition-all fixed left-0 top-0 w-dvw h-[100vh] bg-black/40 grid  lg:grid-cols-2 sm:p-5 sm:justify-end sm:items-end"`}
    >
      <div className=" rounded-sm nav__menu__modal bg-pink-300 h-full w-full lg:col-start-2 lg:w-auto sm:w-[420px]">
        <div
          className={`nav__menu__top h-16 flex items-center justify-between`}
        >
          <Link
            href={"#"}
            className=" pl-5 nav__logo font-extrabold text-2xl transform-3d   "
          >
            herb.
          </Link>
          <button
            type="button"
            className=" active:rotate-0 active:scale-95 hover:rotate-8 hover:scale-105 transition-all"
          >
            <X
              onClick={() => {
                setMenuIsOpen(false);
              }}
              size={48}
              strokeWidth={1}
              className="text-white"
            ></X>
          </button>
        </div>
        <div className={`nav__menu__content h-full p-5`}>
        </div>
      </div>
    </menu>
  );
}

function NavCta() {
  return (
    <div className=" flex items-center justify-center order-2">
      <button
        type="button"
        className=" cursor-pointer outline-2 p-2 rounded-full outline-pink-300 hover:bg-pink-300 hover:scale-105 active:scale-95 active:opacity-90 transition-all "
      >
        Call to Action
      </button>
    </div>
  );
}

function NavPhone({ phone = "559-XXX-XXXX" }) {
  return (
    <div className="flex items-center font-extrabold underline">
      <Phone size={16} className="mr-1"></Phone>
      <a href={`tel:${phone}`}>{phone}</a>
    </div>
  );
}

const LINKS = [
  {
    name: "Dropdown",
    link: "/",
    links: [
      { name: "you", link: "/" },
      { name: "cannot", link: "/" },
      { name: "see!", link: "/" },
    ],
  },
  { name: "Home", link: "/" },
  { name: "Contact", link: "/contact" },
];

function NavDropdownLink({ name, link, links }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const dropdownLinks = links.map((link) => {
    return (
      <li key={link.name} className="flex flex-col items-stretch">
        <Link href={`${link.link}`}>{link.name}</Link>
      </li>
    );
  });

  return (
    <li>
      <div
        className="nav__link__dropdown flex justify-center relative min-w-fit  w-full"
        onMouseOver={(e) => {
          setDropdownOpen(true);
        }}
        onMouseLeave={(e) => {
          setDropdownOpen(false);
        }}
      >
        <Link className="flex justify-center items-center" href={`${link}`}>
          {name}
          <ChevronDown
            className={`${
              dropdownOpen ? "-rotate-180" : ""
            } transition-transform`}
          />
        </Link>
        <div
          className={`link__dropdown__container min-w-[150%] top-full absolute pt-3  ${
            dropdownOpen ? " block " : " hidden "
          } `}
        >
          <ul
            className={`bg-pink-300 text-left p-3 rounded-md min-w-fit w-full  `}
          >
            {dropdownLinks}
          </ul>
        </div>
      </div>
    </li>
  );
}

function NavLinks() {
  const [dropdownOpen, setDropdownOpen] = useState(false);

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
          <Link href={link.link}>{link.name}</Link>
        </li>
      );
    }
  });
  return (
    <div className=" hidden font-sans  nav__links md:flex text-center items-center">
      <ul className="flex font text-lg items-center gap-5 lg:gap-10 ">
        {links}
      </ul>
    </div>
  );
}

function NavMenuButton({ setMenuIsOpen }) {
  return (
    <button
      onClick={() => {
        setMenuIsOpen(true);
      }}
      type="button"
      className=" cursor-pointer  nav__button--open md:hidden order-4 "
    >
      <Menu className=" " strokeWidth={2}></Menu>
    </button>
  );
}

function NavLogo() {
  return (
    <Link href={"#"} className=" nav__logo">
      {/* logo would go in here */}
      <h1 className="font-extrabold text-2xl">herb.</h1>
    </Link>
  );
}

export default function Navbar({
  triggerRef,
  phoneVisible,
  ctaVisible,
  phone = "559-XXX-XXXX",
}) {
  const navContainer = useRef();
  const [menuIsOpen, setMenuIsOpen] = useState(false);

  return (
    <nav
      ref={navContainer}
      className=" fixed perspective-midrange w-[100vw] nav__container text-white h-16 flex justify-between items-center p-5 lg:p-12 "
    >
      {/* nav background */}
      <div className="nav__background rounded-b-xs    left-0 right-0 h-full -z-10 absolute"></div>
      <div className="nav__left">
        <NavLogo />
      </div>
      <div className="nav__right gap-5 lg:gap-10 flex">
        <NavMenuButton setMenuIsOpen={setMenuIsOpen} />
        {phoneVisible && <NavPhone />}
        {ctaVisible && <NavCta />}
        <NavLinks />
        <NavMenu
          menuIsOpen={menuIsOpen}
          setMenuIsOpen={setMenuIsOpen}
        ></NavMenu>
      </div>
    </nav>
  );
}
