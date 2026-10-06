import { geist, spencer, spencerOutlined } from "@/app/fonts";
import { email } from "@/app/constants";
import BlobPlaygroundField from "./BlobPlaygroundField";
import "./blobs.css";

function Smiley({ filled }) {
  const face = filled ? "var(--blobs-face, var(--color-surface, #fff))" : "currentColor";
  return (
    <svg className="blobs-smiley" viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r={filled ? 11 : 10.2}
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="8.6" cy="9.4" r="1.4" fill={face} />
      <circle cx="15.4" cy="9.4" r="1.4" fill={face} />
      <path
        d="M7.4 14.2c1.2 2.2 3 3.2 4.6 3.2s3.4-1 4.6-3.2"
        fill="none"
        stroke={face}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function BlobsExperience() {
  return (
    <main className={`blobs-page bg-surface text-ink ${geist.className}`}>
      <BlobPlaygroundField />
      <section className="blobs-scene">
        <h1 className="blobs-line">
          <span className={`blobs-serif ${spencer.className}`}>Herbart</span> Hernandez is a Frontend{" "}
          <span className={`blobs-serif ${spencerOutlined.className}`}>Developer,</span> currently open
          for work{" "}
          <span className="blobs-smileys">
            <Smiley />
            <Smiley filled />
          </span>
        </h1>
      </section>
      <section className="blobs-scene" data-align="end">
        <p className="blobs-line">
          I build the parts of a product you{" "}
          <span className={`blobs-serif ${spencer.className}`}>touch.</span>
        </p>
      </section>
      <section className="blobs-scene">
        <p className="blobs-line">
          Small details that make it feel{" "}
          <span className={`blobs-serif ${spencerOutlined.className}`}>instant.</span>
        </p>
      </section>
      <section className="blobs-scene" data-align="end">
        <p className="blobs-line">
          Motion that{" "}
          <span className={`blobs-serif ${spencer.className}`}>answers</span> back.
        </p>
      </section>
      <section className="blobs-scene">
        <p className="blobs-line">
          Say hi at{" "}
          <a className="blobs-link" href={`mailto:${email}`}>
            {email}
          </a>
        </p>
      </section>
    </main>
  );
}
