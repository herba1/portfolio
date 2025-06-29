import { instrumentSerif, inter } from "@/app/fonts";
import { ExternalLink, Plus, SquareArrowOutUpRight } from "lucide-react";

export default function Portoflio() {
  return (
    <section className="h-fit w-full">
      <h2
        className={`text-dark tracking-heading-mobile lg:tracking-heading text-6xl lg:text-8xl ${instrumentSerif.className}`}
      >
        Portoflio
      </h2>
      <ul className="">
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
          {/* <Plus className=" col-start-4 text-dark/80 justify-self-end "></Plus> */}
        </li>
        {/* list item generic */}
        <li className="relative min-h-fit font-medium">
          <div className="text-dark hover:bg-dark hover:text-light heading grid grid-cols-4 gap-4 py-2 transition-all duration-500 ease-[cubic-bezier(0,1.11,.53,.95)] hover:px-2 md:grid-cols-12 md:gap-6">
            <h3 className="tracking-body-base md:col-span-4">Linux-Lab</h3>
            <h3 className="tracking-body-base hidden md:col-span-4 md:block">
              Frontend Developer, Designer
            </h3>
            <h3 className="tracking-body-base col-start-3 md:col-span-1">
              2025
            </h3>
            <Plus className="justify-self-end md:col-start-12"></Plus>
          </div>
          <div className="content flex flex-col gap-10 py-5 lg:gap-6">
            <h3
              className={` ${instrumentSerif.className} tracking-heading-mobile text-5xl lg:text-6xl`}
            >
              Linux-Lab
            </h3>
            <div className="content__text__section flex flex-col gap-10 lg:flex-row lg:gap-6">
              <article
                className={`content__desc tracking-body-base flex flex-1/2 flex-col gap-4 leading-normal ${inter.className}`}
              >
                <p>
                  The Linux-Lab is a learning platform that aims to make
                  learning and using the terminal with bash easy, accessible,
                  and free. I handled the entire front-end development for this
                  project, taking it from initial design concepts through to
                  final implementation.
                </p>
                <p>
                  This project was built completely from scratch using no
                  frameworks or libraries. I relied entirely on my fundamental
                  knowledge of core web languages, demonstrating a deep
                  understanding of web development principles without depending
                  on external tools or pre-built solutions.
                </p>
                <p>
                  Throughout the development process, I created custom state
                  management systems and interactive elements, working
                  efficiently to deliver a fully functional platform. This
                  approach showcased my ability to build complex web
                  applications using pure web fundamentals and custom-coded
                  solutions.
                </p>
              </article>
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
            </div>
            <div className="content__testimony mx-auto my-6 lg:grid grid-cols-12 gap-6">
              <p className={`${instrumentSerif.className} col-start-3 max-w-2xl lg:max-w-7xl lg:text-4xl col-span-8 text-2xl text-center tracking-heading leading-tight`}>
                "Working as Herbart's client to develop my art website was great! He asked clear, detailed questions to gauge my thoughts and preferences, and was able to elaborate if I was uncertain or confused. Herbart was very efficient, and gave many progress updates over the span of the month we worked together. He captured my ideas amazingly, and went above and beyond in areas where I gave him creative freedom. The colors and animations of the website are very aesthetically pleasing just as I was hoping, so I'm happy with the results!"
              </p>
            </div>
          </div>
          <div className="border-anim border-dark pointer-events-none absolute top-0 left-0 h-full w-full border-b-2"></div>
        </li>
      </ul>
    </section>
  );
}
