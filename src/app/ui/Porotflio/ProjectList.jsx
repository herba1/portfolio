"use client";
import { instrumentSerif, inter } from "@/app/fonts";
import { ExternalLink, Plus } from "lucide-react";
import Image from "next/image";
import { PortableText } from "next-sanity";
import { urlFor } from "@/sanity/lib/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useRef, useState } from "react";
import { useLenis } from "@/context/LenisContext";

const isTouchDevice = () => {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
};

function ProjectHeader({ className = "", data, onClick }) {
  const { name, year, work } = data;
  const [hover, setHover] = useState(false);
  const [hoverDirection, setHoverDirection] = useState("top"); // 'top' | 'bottom'
  const container = useRef(null);

  const tweenSettings = { duration: 0.5, ease: "power3.out" };

  useGSAP(
    () => {
      if (hover) {
        if (hoverDirection === "top") {
          gsap.fromTo(
            ".bg",
            { clipPath: "inset(0% 0% 100% 0%)", immediateRender: false },
            {
              clipPath: "inset(0% 0% 0% 0%)",
              immediateRender: false,
              duration: tweenSettings.duration,
              ease: tweenSettings.ease,
            },
          );
        }

        if (hoverDirection == "bottom") {
          gsap.fromTo(
            ".bg",
            { clipPath: "inset(100% 0% 0% 0%)", immediateRender: false },
            {
              clipPath: "inset(0% 0% 0% 0%)",
              immediateRender: false,
              duration: tweenSettings.duration,
              ease: tweenSettings.ease,
            },
          );
        }
      }

      if (!hover) {
        if (hoverDirection === "bottom") {
          gsap.fromTo(
            ".bg",
            { clipPath: "inset(0% 0% 0% 0%)", immediateRender: false },
            {
              clipPath: "inset(100% 0% 0% 0%)",
              immediateRender: false,
              duration: tweenSettings.duration,
              ease: tweenSettings.ease,
            },
          );
        }
        if (hoverDirection === "top") {
          gsap.fromTo(
            ".bg",
            { clipPath: "inset(0% 0% 0% 0%)", immediateRender: false },
            {
              clipPath: "inset(0% 0% 100% 0%)",
              immediateRender: false,
              duration: tweenSettings.duration,
              ease: tweenSettings.ease,
            },
          );
        }
      }
    },
    { scope: container, dependencies: [hover] },
  );

  return (
    <button
      ref={container}
      type="button"
      onMouseLeave={() => {
        if (isTouchDevice()) return;
        setHover(false);
      }}
      onMouseEnter={() => {
        if (isTouchDevice()) return;
        setHover(true);
      }}
      onClick={onClick}
      // className={`text-dark hover:bg-dark justify-items-start hover:text-light heading grid grid-cols-4 gap-4 py-2 w-full transition-all duration-300 ease-[cubic-bezier(0,1.11,.53,.95)] hover:px-2 active:px-2.5 md:grid-cols-12 md:gap-6 ${className}`}
      className={`text-dark heading touch-manipulation sm:hover:text-light transition-[padding color] relative grid w-full grid-cols-4 justify-items-start gap-4 overflow-hidden py-2 duration-300 ease-[cubic-bezier(0,1.11,.53,.95)] hover:px-2 active:px-2.5 md:grid-cols-12 md:gap-6 ${className}`}
    >
      <h3 className="tracking-body-base text z-20 col-span-2 text-nowrap md:col-span-4">
        {name}
      </h3>
      <h3 className="tracking-body-base text z-20 hidden md:col-span-4 md:block">
        {work.join(", ")}
      </h3>
      <h3 className="tracking-body-base text z-20 col-start-3 md:col-span-1">
        {year}
      </h3>
      <Plus className="plus text z-20 justify-self-end md:col-start-12"></Plus>
      <div
        onMouseEnter={() => {
          setHoverDirection("top");
        }}
        style={{ clipPath: "inset(0% 0% 50% 0%)" }}
        className="hover__top absolute top-0 left-0 z-10 h-full w-full"
      ></div>
      <div
        onMouseEnter={() => {
          setHoverDirection("bottom");
        }}
        style={{ clipPath: "inset(50% 0% 0% 0%)" }}
        className="hover__top absolute top-0 left-0 z-10 h-full w-full"
      ></div>
      <div
        style={{ clipPath: "inset(100%)" }}
        className="hover__top bg bg-dark hidden sm:block absolute top-0 left-0 z-0 h-full w-full"
      ></div>
    </button>
  );
}

function ProjectGallery({ className = "", data }) {
  const images = data.images.map((image) => {
    return (
      <Image
        key={image.alt}
        src={urlFor(image)
          .width(image.asset.metadata.dimensions.width)
          .height(image.asset.metadata.dimensions.height)
          .url()}
        className="col-span-full aspect-video w-full rounded-2xl object-cover md:col-span-6 lg:col-span-4 xl:col-span-3"
        alt={image.alt}
        height={image.asset.metadata.dimensions.height}
        width={image.asset.metadata.dimensions.width}
        placeholder="blur"
        blurDataURL={image.asset.metadata.lqip}
      ></Image>
    );
  });
  return (
    <div
      className={`grid min-h-fit grid-cols-12 gap-4 overflow-clip ${className}`}
    >
      {images}
    </div>
  );
}

function ProjectTestimony({
  className = "",
  children = "testimony goes here",
}) {
  return (
    <div
      className={`content__testimony mx-auto my-6 grid-cols-12 gap-6 lg:grid`}
    >
      <p
        className={`${instrumentSerif.className} tracking-heading col-span-8 col-start-3 max-w-2xl text-center text-2xl leading-tight lg:max-w-7xl lg:text-4xl`}
      >
        {children}
      </p>
    </div>
  );
}

function ProjectContent({ className = "", data }) {
  return (
    <div className={`content flex flex-col gap-10 lg:gap-6 ${className}`}>
      <h3
        className={` ${instrumentSerif.className} tracking-heading-mobile pt-5 text-5xl lg:text-6xl`}
      >
        {data.name}
      </h3>
      <div className="content__body flex flex-col gap-10 lg:flex-row lg:gap-6">
        <ProjectDescription data={data}></ProjectDescription>
        <ProjectMetadata data={data}></ProjectMetadata>
      </div>
      {data.testimony && <ProjectTestimony>{data.testimony}</ProjectTestimony>}
      <ProjectGallery className="pb-5" data={data}></ProjectGallery>
    </div>
  );
}

export function ProjectDescription({ className = "", data }) {
  return (
    <article
      className={`content__desc tracking-body-base flex flex-1/2 flex-col gap-4 leading-normal font-normal ${inter.className}`}
    >
      <PortableText value={data.description}></PortableText>
    </article>
  );
}

export function ProjectMetadata({ className = "", data }) {
  return (
    <div className="content__extra flex flex-1/2 flex-col justify-between gap-10">
      <div className="content__links flex justify-between lg:order-1">
        <a
          className={`flex font-bold ${!data.githubLink && "pointer-events-none opacity-0"}`}
          href={data.githubLink}
          target="_blank"
          rel="noreferrer noopener"
        >
          Github <ExternalLink></ExternalLink>
        </a>

        <a
          className={`flex font-bold ${!data.visitLink && "pointer-events-none opacity-0"}`}
          href={data.visitLink}
          target="_blank"
          rel="noreferrer noopener"
        >
          Visit Site <ExternalLink></ExternalLink>
        </a>
      </div>
      <ul className="content__metadata flex grid-cols-6 flex-col gap-4 lg:grid">
        <li className="col-span-3 flex flex-col">
          <span className="text-dark/70">Date</span>
          <span className="">{data.year && data.year}</span>
        </li>
        <li className="col-span-3 flex flex-col">
          <span className="text-dark/70">Tech</span>
          <span className="">{data.tech && data.tech.join(", ")}</span>
        </li>
        <li className="col-span-6 flex flex-col">
          <span className="text-dark/70">Work Done</span>
          <span className="">{data.work.join(", ")}</span>
        </li>
      </ul>
    </div>
  );
}

export function ProjectItem({ className = "", data, timelines }) {
  const itemContainer = useRef(null);
  const tl = useRef(null);
  const header = useRef(null);
  const { lenis } = useLenis();

  const { contextSafe } = useGSAP(
    () => {
      const plus = itemContainer.current.querySelector(".plus");
      tl.current = gsap.timeline({ paused: true });
      timelines.current.push(tl.current);
      const content = itemContainer.current.querySelector(
        ".content__container",
      );

      tl.current.set(content, {
        height: 0,
        opacity: 0,
      });

      tl.current
        .to(
          content,
          {
            height: "auto",
            ease: "power4.inOut",
            opacity: 1,
            duration: 0.75,
          },
          "start",
        )
        .to(
          plus,
          {
            rotate: "135deg",
            ease: "power2.inOut",
          },
          "start",
        );
    },
    { scope: itemContainer.current },
  );

  const handleClick = contextSafe(() => {
    if (tl.current.progress() > 0) {
      tl.current.reverse();
    } else {
      for (let tls of timelines.current) {
        if (tl.current != tls) tls.reverse();
      }

      // Then open this one and scroll
      tl.current.play();
    }
  });

  return (
    <li ref={itemContainer} className="relative min-h-fit font-medium">
      <ProjectHeader
        ref={header}
        onClick={handleClick}
        data={data}
        className="hover:cursor-pointer"
      ></ProjectHeader>
      <ProjectContent
        className="content__container h-0 overflow-clip"
        data={data}
      ></ProjectContent>
      <div className="border-animated border-dark pointer-events-none absolute top-0 left-0 h-full w-full border-b-2"></div>
    </li>
  );
}

export function ProjectList({ className = "", data }) {
  const { isOpen, setIsOpen } = useState(false);
  const timelines = useRef([]);
  const items = data.map((item) => {
    return (
      <ProjectItem
        timelines={timelines}
        key={item.name}
        data={item}
      ></ProjectItem>
    );
  });

  return (
    <ul className="project__list" id="project__list__header">
      <li className="grid grid-cols-4 gap-4 border-b-2 py-2 md:grid-cols-12 md:gap-6">
        <h3 className="tracking-body-base text-dark/80 font-bold md:col-span-4">
          Name
        </h3>
        <h3 className="tracking-body-base text-dark/80 hidden font-bold md:col-span-4 md:block">
          Project Type
        </h3>
        <h3 className="tracking-body-base text-dark/80 col-start-3 font-bold md:col-span-1">
          Year
        </h3>
      </li>
      {items}
    </ul>
  );
}
