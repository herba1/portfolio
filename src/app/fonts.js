import { Instrument_Serif, Geist } from "next/font/google";
import localFont from "next/font/local";

export const geist = Geist({
    subsets:['latin'],
    display:'swap',
})

export const instrumentSerif = Instrument_Serif({
    subsets:['latin'],
    weight: ['400'],
    style: ['normal', 'italic'],
    display: 'swap',
})

export const spencer = localFont({
    src: '../../public/spencer-regular-webfont.woff2',
    display: 'swap',
})

export const spencerOutlined = localFont({
    src: '../../public/spencer-outlined-webfont.woff2',
    display: 'swap',
})

export const lastik = localFont({
    src: '../../public/lastikfont.otf',
    display: 'swap',
})
