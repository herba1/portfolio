
export default function StickyFooter({
  height = "100svh",
  children
}) {
  return (
    <footer 
      style={{ height}} 
      className="flex flex-col justify-end overflow-none relative -z-10 bg-black"
    >
      {/* Double height container */}
      <div 
        style={{ height:`calc(${height}*2)` }} 
        className="relative shrink-0"
      >
        {/* Sticky content container */}
        <div 
          style={{ 
            height,
            top: `calc(100vh - ${height})` 
          }} 
          className="w-full sticky"
        >
          {children || <h1 className="font-serif text-7xl  text-white">just because i really &lt;3 u, place your content here</h1>}
          
        </div>
      </div>
    </footer>
  );
}