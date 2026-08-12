import Link from "next/link";

export function SiteNav({ active }: { active: "maintenance" | "negative" }) {
  return (
    <nav className="site-nav" aria-label="评论监测工作台板块">
      <div className="site-nav-inner">
        <span className="site-nav-label">评论监测工作台</span>
        <div className="site-nav-links">
          <Link className={active === "maintenance" ? "active" : ""} href="/">评论维护</Link>
          <Link className={active === "negative" ? "active" : ""} href="/negative-monitor">负评监测延续</Link>
        </div>
      </div>
    </nav>
  );
}
