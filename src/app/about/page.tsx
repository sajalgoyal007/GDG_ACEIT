import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, Braces, Code2, Lightbulb, Radio, Sparkles } from "lucide-react";
import { CommunityFooter } from "@/components/community-footer";
import { CommunityNavigation } from "@/components/community-navigation";

export const metadata: Metadata = {
  title: "About",
  description: "Meet the GDG On Campus ACEIT student developer community, its 2026 organizers, and the learning experience behind Learn with Communities.",
};

const waysToBuild = [
  { title: "Explore technology", detail: "Web development, cloud, AI and machine learning, open source, and the tools around them are all part of the learning conversation.", icon: Lightbulb, color: "blue" },
  { title: "Learn together", detail: "Workshops, technical sessions, and study jams create space to ask questions and practice with peers.", icon: Radio, color: "red" },
  { title: "Build practical skills", detail: "Collaborative projects and hands-on experiments help turn concepts into working prototypes and stronger habits.", icon: Code2, color: "yellow" },
  { title: "Share what works", detail: "Comparing approaches, explaining decisions, and reflecting on a build are part of learning to develop well.", icon: Sparkles, color: "green" },
];

const organizers = ["Sajal Goyal", "Shreya Soni", "Shreyansh Gupta"];

export default function AboutPage() {
  return (
    <div className="community-app dark-community">
      <CommunityNavigation />
      <main className="site-main about-page">
        <section className="about-hero" aria-labelledby="about-title">
          <div className="about-hero-copy">
            <p className="eyebrow"><span className="eyebrow-dot" />OUR COMMUNITY <span className="eyebrow-divider">/</span> KUKAS, JAIPUR</p>
            <h1 id="about-title">Learn together.<br /><span>Build with purpose.</span></h1>
            <p>GDG On Campus ACEIT is a student developer community at Arya College of Engineering &amp; IT in Kukas, Jaipur. Learn with Communities 2026 gives students a place to explore developer technologies, learn from peers, and turn ideas into practical projects—through curiosity, experimentation, and collaboration.</p>
            <Link className="button-primary" href="/progress">Explore recorded progress <span aria-hidden="true">↗</span></Link>
          </div>
          <div className="about-hero-mark" aria-hidden="true"><div className="about-mark-orbit"/><Image src="/gdg-mark.png" alt="" width={116} height={116} priority/><span>LEARN · BUILD · CONNECT</span><Braces className="about-braces" size={34}/></div>
        </section>

        <section className="value-section" aria-labelledby="values-title">
          <div className="section-heading"><div><p className="section-kicker">LEARN · EXPERIMENT · BUILD</p><h2 id="values-title">A community built by doing.</h2></div><p>Technology is best learned together—and understood more deeply when you put it to work.</p></div>
          <div className="value-grid">{waysToBuild.map(({ title, detail, icon: Icon, color }, index) => <article className={`value-card value-${color}`} key={title}><span className="value-number">0{index + 1}</span><span className="value-icon"><Icon size={19} aria-hidden="true"/></span><h3>{title}</h3><p>{detail}</p></article>)}</div>
        </section>

        <section className="organizers-section" aria-labelledby="organizers-title">
          <div className="section-heading"><div><p className="section-kicker">LEARN WITH COMMUNITIES · 2026</p><h2 id="organizers-title">The people organizing this year.</h2></div><p>Meet the current-year organizers for the 2026 experience.</p></div>
          <div className="organizer-grid">{organizers.map((name, index) => <article className={`organizer-card organizer-${index + 1}`} key={name}><span className="organizer-initials" aria-hidden="true">{name.split(" ").map((part) => part[0]).join("")}</span><span className="organizer-role">Organizer · 2026</span><h3>{name}</h3></article>)}</div>
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
          <div className="references-intro"><p className="section-kicker">READ MORE</p><h2 id="references-title">Sources &amp; community references</h2><p>Public profiles and event pages that inform this overview. Historical highlights are attributed to GDG ACEIT’s public updates; they are separate from current participant progress.</p></div>
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
