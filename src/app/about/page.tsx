import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, Braces, Code2, Lightbulb, Radio, Sparkles } from "lucide-react";
import { CommunityFooter } from "@/components/community-footer";
import { CommunityNavigation } from "@/components/community-navigation";

export const metadata: Metadata = {
  title: "About GDG ACEIT | Learn with Communities 2026",
  description: "Learn about GDG On Campus ACEIT, its student developer community, and publicly reported community highlights.",
};

const waysToBuild = [
  { title: "Learn", detail: "Workshops, technical sessions and study jams make room to explore new technologies together.", icon: Lightbulb, color: "blue" },
  { title: "Build", detail: "Hackathons, collaborative projects and hands-on experimentation turn ideas into working things.", icon: Code2, color: "red" },
  { title: "Connect", detail: "Peer learning, speaker sessions and developer collaboration bring the community closer.", icon: Radio, color: "yellow" },
  { title: "Showcase", detail: "Share projects and learning milestones, and celebrate the work behind them.", icon: Sparkles, color: "green" },
];

export default function AboutPage() {
  return (
    <div className="community-app dark-community">
      <CommunityNavigation />
      <main className="site-main about-page">
        <section className="about-hero" aria-labelledby="about-title">
          <div className="about-hero-copy">
            <p className="eyebrow"><span className="eyebrow-dot" />OUR COMMUNITY <span className="eyebrow-divider">/</span> KUKAS, JAIPUR</p>
            <h1 id="about-title">From curious minds<br />to <span>real-world builders.</span></h1>
            <p>GDG On Campus ACEIT is a student developer community at Arya College of Engineering &amp; IT in Kukas, Jaipur. It brings students together to learn new technologies, build practical projects, collaborate with fellow developers and explore solutions to real-world problems.</p>
            <Link className="button-primary" href="/progress">Explore community progress <span aria-hidden="true">↗</span></Link>
          </div>
          <div className="about-hero-mark" aria-hidden="true"><div className="about-mark-orbit"/><Image src="/gdg-mark.png" alt="" width={116} height={116} priority/><span>LEARN · BUILD · CONNECT</span><Braces className="about-braces" size={34}/></div>
        </section>

        <section className="value-section" aria-labelledby="values-title">
          <div className="section-heading"><div><p className="section-kicker">HOW WE MOVE</p><h2 id="values-title">A community built by doing.</h2></div><p>Technology is best learned together—then put to work.</p></div>
          <div className="value-grid">{waysToBuild.map(({ title, detail, icon: Icon, color }, index) => <article className={`value-card value-${color}`} key={title}><span className="value-number">0{index + 1}</span><span className="value-icon"><Icon size={19} aria-hidden="true"/></span><h3>{title}</h3><p>{detail}</p></article>)}</div>
        </section>

        <section className="highlights-section" aria-labelledby="highlights-title">
          <div className="section-heading"><div><p className="section-kicker">PAST WORK, PUBLICLY REPORTED</p><h2 id="highlights-title">Community highlights.</h2></div><p>Historical snapshots. These are not live 2026 leaderboard totals.</p></div>
          <div className="highlight-grid">
            <article className="highlight-card highlight-cloud"><span className="highlight-index">01 / LEARN</span><span className="highlight-period">2025</span><h3>Google Cloud<br/>Study Jams</h3><p>GDG ACEIT reported 500+ registrations and 100+ participants achieving perfect lab completion scores, and shared that the chapter reached Tier 1 status.</p><a href="https://in.linkedin.com/company/gdg-aceit" target="_blank" rel="noreferrer">Read the community report <ArrowUpRight size={15} aria-hidden="true"/></a></article>
            <article className="highlight-card highlight-sprint"><span className="highlight-index">02 / BUILD</span><span className="highlight-period">2025–26</span><h3>TechSprint</h3><p>An AI-focused hackathon and innovation initiative organized by GDG ACEIT, creating a space for teams to develop and pitch ideas.</p><a href="https://in.linkedin.com/company/gdg-aceit" target="_blank" rel="noreferrer">Explore GDG ACEIT updates <ArrowUpRight size={15} aria-hidden="true"/></a></article>
            <article className="highlight-card highlight-medha"><span className="highlight-index">03 / SHOWCASE</span><span className="highlight-period">TECHSPRINT</span><h3>Team Medha<br/><span>First place.</span></h3><p>A public community repost celebrated Team Medha’s first-place finish at GDG TechSprint.</p><a href="https://in.linkedin.com/company/gdg-aceit" target="_blank" rel="noreferrer">View the community profile <ArrowUpRight size={15} aria-hidden="true"/></a></article>
          </div>
        </section>

        <section className="references-section" aria-labelledby="references-title">
          <div className="references-intro"><p className="section-kicker">READ MORE</p><h2 id="references-title">Sources &amp; community references</h2><p>Public profiles and event pages that inform this overview. Historical claims above are attributed to GDG ACEIT’s public updates.</p></div>
          <div className="reference-links">
            <a href="https://in.linkedin.com/company/gdg-aceit" target="_blank" rel="noreferrer"><span><small>COMMUNITY PROFILE</small><strong>GDG ACEIT on LinkedIn</strong></span><ArrowUpRight size={16} aria-hidden="true"/></a>
            <a href="https://www.aryacollege.in/arya-event/arya-gdg-club" target="_blank" rel="noreferrer"><span><small>CAMPUS CLUB</small><strong>Arya GDG Club · Arya College</strong></span><ArrowUpRight size={16} aria-hidden="true"/></a>
            <a href="https://gdg.community.dev/events/details/google-gdg-on-campus-arya-college-of-engineering-it-jaipur-india-presents-google-cloud-study-jams-2025/" target="_blank" rel="noreferrer"><span><small>EVENT LISTING</small><strong>Google Cloud Study Jams 2025</strong></span><ArrowUpRight size={16} aria-hidden="true"/></a>
            <a href="https://gdg.community.dev/events/details/google-gdg-on-campus-arya-college-of-engineering-it-jaipur-india-presents-mastering-salesforce-amp-agentforce-workshop/" target="_blank" rel="noreferrer"><span><small>GDG ON CAMPUS</small><strong>Official event example</strong></span><ArrowUpRight size={16} aria-hidden="true"/></a>
          </div>
        </section>
        <CommunityFooter />
      </main>
    </div>
  );
}
