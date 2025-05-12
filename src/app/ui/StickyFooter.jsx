export default function StickyFooter({ height = "100svh", children }) {
  return (
    <footer
      style={{ height }}
      className="flex flex-col justify-end overflow-none relative -z-10 bg-black"
    >
      {/* Double height container */}
      <div
        style={{ height: `calc(${height}*2)` }}
        className="relative shrink-0"
      >
        {/* Sticky content container */}
        <div
          style={{
            height,
            top: `calc(100vh - ${height})`,
          }}
          className="w-full sticky"
        >
          {children || (
            <div className="w-full overflow-clip h-full flex flex-col bg-blue-700 justify-end p-4 ">
              <h1 className="font-serif text-8xl text-white">
                place your content here
              </h1>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
