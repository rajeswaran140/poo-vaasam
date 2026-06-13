/**
 * Cover for a poem card. When the poem has a featuredImage we show it; otherwise
 * we render a branded green gradient card carrying the poem's title — so every
 * poem looks like it has a cover (no bare emoji placeholder), automatically and
 * with no AI / storage cost. Green matches the /poems section accent.
 */

interface PoemCoverProps {
  title: string;
  featuredImage?: string | null;
}

export function PoemCover({ title, featuredImage }: PoemCoverProps) {
  if (featuredImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={featuredImage}
        alt={title}
        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
        loading="lazy"
      />
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-green-500 via-green-600 to-green-700 p-4 text-center transition-transform duration-500 group-hover:scale-105">
      <span className="font-kavivanar text-xl sm:text-2xl font-bold leading-tight text-white line-clamp-3 drop-shadow">
        {title}
      </span>
      <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/85">
        கவிதை
      </span>
    </div>
  );
}
