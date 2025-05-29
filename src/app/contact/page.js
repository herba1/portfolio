"use client";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger, SplitText, ScrambleTextPlugin } from "gsap/all";
import { useGSAP } from "@gsap/react";
import { useRef } from "react";

gsap.registerPlugin(SplitText);

export default function LinkMask() {
  const container = useRef();

  const { contextSafe } = useGSAP(() => {
    let textSplits = SplitText.create('.animate__line--text',{type:'lines,chars',mask:'lines'});
    let titleSplits = SplitText.create('.animate__line--title',{type:'lines,chars',mask:'lines'});
    let splitTl = gsap.timeline();
    splitTl.from(textSplits.lines, {
      yPercent:100,
      duration:1,
      stagger:0.05,
      ease:'power4.out',
    },'start')
    .from(titleSplits.lines,{
      yPercent:100,
      duration:1,
      stagger:0.05,
      ease:'power4.out',
    },'start+=0.5')
    return(()=>{
      if(textSplits)textSplits.revert();
      if(titleSplits)titleSplits.revert();
      if(splitTl)splitTl.kill();
    })
  }, {
    scope: container,
    dependencies: null,
  });

  return (
    <div
      ref={container}
      className="w-dvw h-dvh flex justify-center items-center"
    >
      <section>
        <h3 className="animate__line--title">one</h3>
        <ul className="animate__line--text">
          <li className="">Somewhere</li>
          <li>
            <p>Where one may</p>
          </li>
          <li>
            <span>DO STUFF</span>
          </li>
        </ul>
      </section>
      <section>
        <h3 className="animate__line--title">one</h3>
        <ul className="animate__line--text">
          <li className="">Somewhere</li>
          <li>
            <p>Where one may</p>
          </li>
          <li>
            <span>DO STUFF</span>
          </li>
        </ul>
      </section>
      <section>
        <h3 className="animate__line--title">one</h3>
        <ul className="animate__line--text">
          <li className="">Somewhere</li>
          <li>
            <p>Where one may</p>
          </li>
          <li>
            <span>DO STUFF</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
