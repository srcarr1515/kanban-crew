interface BrandLogoProps {
  className?: string;
  alt?: string;
}

export function BrandLogo({
  className = "h-8 w-auto",
  alt = "Kanban Crew",
}: BrandLogoProps) {
  return (
    <picture>
      <source
        srcSet="/kanban-crew-logo-dark.svg"
        media="(prefers-color-scheme: dark)"
      />
      <img src="/kanban-crew-logo.svg" alt={alt} className={className} />
    </picture>
  );
}
