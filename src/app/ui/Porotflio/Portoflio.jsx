import { getProjects } from "@/app/api/cmsData";
import { instrumentSerif, inter } from "@/app/fonts";
import { ExternalLink, Plus} from "lucide-react";
import Image from "next/image";
import { ConfigResolutionError } from "sanity";

function ProjectHeader({ className = "", name, year, work }) {
  return (
    <div className="text-dark hover:bg-dark hover:text-light heading grid grid-cols-4 gap-4 py-2 transition-all duration-500 ease-[cubic-bezier(0,1.11,.53,.95)] hover:px-2 md:grid-cols-12 md:gap-6">
      <h3 className="tracking-body-base md:col-span-4">Linux-Lab</h3>
      <h3 className="tracking-body-base hidden md:col-span-4 md:block">
        Frontend Developer, Designer
      </h3>
      <h3 className="tracking-body-base col-start-3 md:col-span-1">2025</h3>
      <Plus className="justify-self-end md:col-start-12"></Plus>
    </div>
  );
}

function ProjectGallery({ className = "", images = [] }) {
  // add images sanity cms
  return (
    <div
      className={`grid min-h-fit grid-cols-12 gap-4 overflow-clip ${className}`}
    >
      <Image
        src={"/1.png"}
        className="col-span-full aspect-video w-full rounded-2xl object-cover md:col-span-6 lg:col-span-4 xl:col-span-3"
        alt="img"
        height={300}
        width={300}
        // style={{imageRendering:'pixelated'}}
      ></Image>
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

function ProjectContent({ className = "" }) {
  return (
    <div className="content flex flex-col gap-10 py-5 lg:gap-6">
      <h3
        className={` ${instrumentSerif.className} tracking-heading-mobile text-5xl lg:text-6xl`}
      >
        Linux-Lab
      </h3>
      <div className="content__body flex flex-col gap-10 lg:flex-row lg:gap-6">
        <ProjectDescription></ProjectDescription>
        <ProjectMetadata></ProjectMetadata>
      </div>
      <ProjectTestimony></ProjectTestimony>
      <ProjectGallery></ProjectGallery>
    </div>
  );
}

export function ProjectDescription({ className = "", data }) {
  return (
    <article
      className={`content__desc tracking-body-base flex flex-1/2 flex-col gap-4 leading-normal ${inter.className}`}
    >
      <p>
        Throughout the development process, I created custom state management
        systems and interactive elements, working efficiently to deliver a fully
        functional platform. This approach showcased my ability to build complex
        web applications using pure web fundamentals and custom-coded solutions.
      </p>
    </article>
  );
}

export function ProjectMetadata({ className = "", data }) {
  return (
    <div className="content__extra flex flex-1/2 flex-col justify-between gap-10">
      <div className="content__links flex justify-between lg:order-1">
        <a className="flex font-bold" href="#">
          Github <ExternalLink></ExternalLink>
        </a>
        <a className="flex font-bold" href="#">
          Visit Site <ExternalLink></ExternalLink>
        </a>
      </div>
      <ul className="content__metadata flex grid-cols-6 flex-col gap-4 lg:grid">
        <li className="col-span-3 flex flex-col">
          <span className="text-dark/70">Date</span>
          <span className="">2025</span>
        </li>
        <li className="col-span-3 flex flex-col">
          <span className="text-dark/70">Tech</span>
          <span className="">
            Vanilla JS, HTML, CSS, Figma, GSAP, TailwindCSS
          </span>
        </li>
        <li className="col-span-6 flex flex-col">
          <span className="text-dark/70">Services</span>
          <span className="">Frontend Development, Web Design</span>
        </li>
      </ul>
    </div>
  );
}

export function ProjectItem({ className = "", data }) {
  console.log(data);
  return (
    <li className="relative min-h-fit font-medium">
      <ProjectHeader></ProjectHeader>
      <ProjectContent></ProjectContent>
      <div className="border-anim border-dark pointer-events-none absolute top-0 left-0 h-full w-full border-b-2"></div>
    </li>
  );
}

export function ProjectList({ className = "",data }) {

  // console.log(data);
  const items = data.map((item)=>{
    return(<ProjectItem data={item}></ProjectItem>)
  })

  return (
    <ul className="project__list">
      {/* list header */}
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
      {/* list item generic */}
      {items}
    </ul>
  );
}

export default async function Portoflio() {
  const projects = await getProjects();
  // console.log(projects)

  return (
    <section className="h-fit w-full">
      <h2
        className={`text-dark tracking-heading-mobile lg:tracking-heading text-6xl lg:text-8xl ${instrumentSerif.className}`}
      >
        Portoflio
      </h2>
      <ProjectList data={projects}></ProjectList>
    </section>
  );
}
