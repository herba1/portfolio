import "./piece.css";

// The box every piece renders into — see piece.css for the contract.
// `viewport` makes it the full screen, for a piece's own page.
export default function PieceBox({ viewport = false, className = "", children, ...rest }) {
  return (
    <div className={`piece-box${viewport ? " piece-box--viewport" : ""} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
