import { Inter, Instrument_Serif } from "next/font/google";
import localFont from "next/font/local";

export const inter = Inter({
    subsets:['latin'],
    display:'swap',
})

export const instrumentSerif = Instrument_Serif({
    subsets:['latin'],
    weight: ['400'],
})

export const spencer = localFont({
    src: '../../public/spencer-regular-webfont.woff2',
})

export const spencerOutlined = localFont({
    src: '../../public/spencer-outlined-webfont.woff2',
})

export const lastik = localFont({
    src: '../../public/lastikfont.otf',
})