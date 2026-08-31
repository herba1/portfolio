const CELLS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function UploadDropZone93ffRoll({ value, height = 16, minChars = 0, pace = "step" }) {
  const digits = String(Math.max(0, Math.round(value))).split("");

  return (
    <span
      className="udz-roll"
      data-pace={pace}
      style={{ "--udz-roll-h": `${height}px`, minWidth: minChars ? `${minChars}ch` : undefined }}
    >
      {digits.map((char, index) => (
        <span key={digits.length - index} className="udz-roll-digit">
          <span className="udz-roll-col" style={{ "--udz-d": Number(char) }}>
            {CELLS.map((cell) => (
              <span key={cell}>{cell}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}
