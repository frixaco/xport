import { Link } from "@tanstack/react-router";

const seoLinks = [
  { to: "/export-x-posts", label: "Export X posts" },
  { to: "/export-x-threads", label: "Export X threads" },
  { to: "/save-x-articles", label: "Save X articles" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm sm:flex-row">
        <Link to="/" className="font-semibold tracking-tight">
          Xport
        </Link>
        <nav
          className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-muted-foreground"
          aria-label="Export guides"
        >
          {seoLinks.map((link) => (
            <Link key={link.to} to={link.to} className="transition-colors hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
        <a
          href="https://github.com/frixaco/xport"
          className="text-muted-foreground transition-colors hover:text-foreground"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
