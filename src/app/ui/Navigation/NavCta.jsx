
export default function NavCta({text="Call to Action"}) {
  return (
    <div className=" flex items-center justify-center order-2">
      <button type="button" className="btn btn--primary rounded-full">
        {text}
      </button>
    </div>
  );
}