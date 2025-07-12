import { createContext, useContext, useRef } from "react";
import gsap from "gsap";

const TimelineContext = createContext(null);

export function TimelineProvider({children}){

    const timelineRef = useRef(null);

    if(!timelineRef.current){
        timelineRef.current = gsap.timeline({paused:true});
    }

    return(
        <TimelineContext value={timelineRef.current}>
            {children}
        </TimelineContext>
    )

}

export const useTimeline = ()=>{
    const context = useContext(TimelineContext);
    if(!context){
        console.error('context needs provider')
        return null;
    }
    return context;
}
