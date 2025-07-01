"use client";
import { instrumentSerif, inter } from "@/app/fonts";
import { ExternalLink, Plus } from "lucide-react";
import Image from "next/image";
import { PortableText } from "next-sanity";
import { urlFor } from "@/sanity/lib/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useRef } from "react";

function ProjectHeader({ className = "", data, onClick }) {
  const { name, year, work } = data;

  return (
    <div
      onClick={onClick}
      className="text-dark hover:bg-dark hover:text-light heading grid grid-cols-4 gap-4 py-2 transition-all duration-300 ease-[cubic-bezier(0,1.11,.53,.95)] hover:px-2 md:grid-cols-12 md:gap-6"
    >
      <h3 className="tracking-body-base col-span-2 md:col-span-4">{name}</h3>
      <h3 className="tracking-body-base hidden md:col-span-4 md:block">
        {work.join(", ")}
      </h3>
      <h3 className="tracking-body-base col-start-3 md:col-span-1">{year}</h3>
      <Plus className="justify-self-end md:col-start-12"></Plus>
    </div>
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
        >
          Github <ExternalLink></ExternalLink>
        </a>

        <a
          className={`flex font-bold ${!data.visitLink && "pointer-events-none opacity-0"}`}
          href={data.visitLink}
        >
          Visit Site <ExternalLink></ExternalLink>
        </a>
      </div>
      <ul className="content__metadata flex grid-cols-6 flex-col gap-4 lg:grid">
        <li className="col-span-3 flex flex-col">
          <span className="text-dark/70">Date</span>
          <span className="">{data.year}</span>
        </li>
        <li className="col-span-3 flex flex-col">
          <span className="text-dark/70">Tech</span>
          <span className="">{data.tech.join(", ")}</span>
        </li>
        <li className="col-span-6 flex flex-col">
          <span className="text-dark/70">Work Done</span>
          <span className="">{data.work.join(", ")}</span>
        </li>
      </ul>
    </div>
  );
}

export function ProjectItem({ className = "", data }) {
  const itemContainer = useRef(null);
  const tl = useRef(null);

  const { contextSafe } = useGSAP(
    () => {
      tl.current = gsap.timeline({ paused: true });
      const content = itemContainer.current.querySelector(
        ".content__container",
      );

      tl.current.set(content, {
        height: 0,
        opacity: 0,
      });

      tl.current.to(content, {
        height: "auto",
        ease: "power4.out",
        opacity: 1,
        duration: 0.5,
        onComplete: () => {
          console.log("complete");
        },
      });
    },
    { scope: itemContainer.current },
  );

  const handleClick = contextSafe(() => {
    if (tl.current.progress() > 0) {
      tl.current.reverse();
    } else {
      tl.current.play();
    }
  });

  return (
    <li ref={itemContainer} className="relative min-h-fit font-medium">
      <ProjectHeader onClick={handleClick} data={data}></ProjectHeader>
      <ProjectContent
        className="content__container h-0 overflow-clip"
        data={data}
      ></ProjectContent>
      <div className="border-animated border-dark pointer-events-none absolute top-0 left-0 h-full w-full border-b-2"></div>
    </li>
  );
}

export function ProjectList({ className = "", data }) {
  const items = data.map((item) => {
    return <ProjectItem key={item.name} data={item}></ProjectItem>;
  });

  return (
    <ul className="project__list">
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
