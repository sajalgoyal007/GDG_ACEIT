import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Cloud,
  Code2,
  GitBranch,
  Globe2,
  GraduationCap,
  Rocket,
  Sparkles,
  Trophy,
  Users,
  Wrench,
} from "lucide-react";
import { CommunityFooter } from "@/components/community-footer";
import { CommunityNavigation } from "@/components/community-navigation";
import { Tilt } from "@/components/tilt";

export const metadata: Metadata = {
  title: "About",
  description: "Meet GDG On Campus ACEIT — the student developer chapter at Arya College of Engineering & IT, Kukas, Jaipur — its mission, milestones, and 2026–2027 organizing team.",
};

const impactStats = [
  { value: "195+", label: "Active Cloud Learners", detail: "Builders exploring Google Cloud and AI", icon: Users, tone: "blue" },
  { value: "Tier 1", label: "Study Jam Chapter", detail: "Recognised for campaign participation", icon: BadgeCheck, tone: "green" },
  { value: "Campus", label: "Hackathons & DevFests", detail: "Build weekends across ACEIT", icon: Rocket, tone: "red" },
  { value: "Peer-led", label: "Technical Workshops", detail: "Sessions led by student builders", icon: GraduationCap, tone: "yellow" },
] as const;

const pillars = [
  {
    title: "Cloud & AI Study Jams",
    detail: "Structured Google Cloud learning paths, Gen AI labs, and cohort accountability that turn curiosity into completed Skill Badges.",
    icon: Cloud,
    tone: "blue",
    tags: ["Google Cloud", "Vertex AI", "Study Jams"],
  },
  {
    title: "Hackathons & Rapid Prototyping",
    detail: "Campus-wide sprints where teams scope an idea, ship a working prototype, and pitch it to builders and mentors in days.",
    icon: Rocket,
    tone: "red",
    tags: ["TechSprint", "Hack-Arya-Verse", "Pitch day"],
  },
  {
    title: "Open-Source & Peer Mentorship",
    detail: "First pull requests, code reviews, and mentor circles that make contributing to real repositories feel approachable.",
    icon: GitBranch,
    tone: "yellow",
    tags: ["GitHub", "Code review", "Mentor circles"],
  },
  {
    title: "Production Engineering",
    detail: "Beyond the demo: testing, deployment, performance, and the engineering habits that carry a project into production.",
    icon: Wrench,
    tone: "green",
    tags: ["Ship", "Test", "Scale"],
  },
] as const;

const highlights = [
  {
    kicker: "LEARN · 2026",
    title: "Google Cloud Study Jams & Learn with Communities",
    detail: "Tier 1 chapter recognition, guided Cloud Skills Boost paths, and verified badge progression across the 2026 campaign.",
    icon: Cloud,
    tone: "blue",
    href: "https://gdg.community.dev/events/details/google-gdg-on-campus-arya-college-of-engineering-it-jaipur-india-presents-google-cloud-study-jams-2025/",
    link: "View the study jam listing",
  },
  {
    kicker: "BUILD · CAMPUS",
    title: "TechSprint ACEIT Hackathon",
    detail: "A campus-wide innovation sprint where student teams build practical software solutions and present them to the chapter.",
    icon: Rocket,
    tone: "red",
    href: "https://in.linkedin.com/company/gdg-aceit",
    link: "See chapter updates",
  },
  {
    kicker: "CONNECT · KUKAS",
    title: "Hack-Arya-Verse & Campus Developer Culture",
    detail: "Collaborative hackathons and developer sessions at Arya Old Campus, Kukas, growing a shared builder culture across batches.",
    icon: Sparkles,
    tone: "yellow",
    href: "https://www.aryacollege.in/arya-event/arya-gdg-club",
    link: "Explore the campus club",
  },
  {
    kicker: "WIN · TEAM MEDHA",
    title: "Student Builder Wins & Hackathon Champions",
    detail: "ACEIT builders earning first place in campus and inter-college hackathons — including Team Medha's championship finish.",
    icon: Trophy,
    tone: "green",
    href: "https://in.linkedin.com/company/gdg-aceit",
    link: "Read the community post",
  },
] as const;

const team = [
  {
    name: "Sajal Goyal",
    initials: "SG",
    role: "Student Organizer / Lead",
    focus: "Campaign direction, partner coordination, and the chapter's cloud learning roadmap.",
    tone: "blue",
  },
  {
    name: "Shreya Soni",
    initials: "SS",
    role: "Co-Organizer / Core Team",
    focus: "Community operations, event experience, and peer learning circles.",
    tone: "red",
  },
  {
    name: "Shreyansh Gupta",
    initials: "SG",
    role: "Co-Organizer / Core Team",
    focus: "Technical programming, hackathon mentorship, and builder support.",
    tone: "green",
  },
] as const;

const communityLinks = [
  {
    href: "https://gdg.community.dev/",
    label: "GDG Community",
    detail: "Find GDG On Campus chapters and upcoming Google developer events.",
    icon: Globe2,
    external: true,
  },
  {
    href: "https://in.linkedin.com/company/gdg-aceit",
    label: "GDG ACEIT on LinkedIn",
    detail: "Chapter announcements, event recaps, and student builder wins.",
    icon: Users,
    external: true,
  },
  {
    href: "https://www.aryacollege.in/arya-event/arya-gdg-club",
    label: "Arya GDG Club",
    detail: "The chapter home at Arya College of Engineering & IT, Kukas.",
    icon: GraduationCap,
    external: true,
  },
] as const;

export default function AboutPage() {
  return (
    <div className="g-app">
      <CommunityNavigation />
      <main className="g-main g-about-main">
        <section className="g-about-hero" aria-labelledby="about-title">
          <div className="g-about-copy">
            <p className="g-eyebrow"><span className="g-eyebrow-dot" />OUR CHAPTER <span>/</span> KUKAS, JAIPUR</p>
            <h1 id="about-title">GDG On Campus <span className="g-hero-gradient">ACEIT</span></h1>
            <p className="g-about-lede">
              We help student developers at Arya College of Engineering &amp; IT bridge academic learning and real-world cloud, AI, web, and open-source engineering — through Google&apos;s <span className="g-inline-code">&lt; / &gt;</span> ethos of <strong>Learn · Build · Connect</strong>.
            </p>
            <div className="g-about-actions">
              <Link className="g-btn g-btn-primary" href="/progress">Explore the leaderboard <ArrowRight size={16} aria-hidden="true" /></Link>
              <a className="g-btn g-btn-ghost" href="https://gdg.community.dev/" target="_blank" rel="noreferrer">Visit GDG Community <ArrowUpRight size={16} aria-hidden="true" /></a>
            </div>
            <div className="g-about-tags">
              <span>Learn</span><span>Build</span><span>Connect</span>
            </div>
          </div>

          <div className="g-about-visual" aria-hidden="true">
            <span className="g-about-ring" />
            <span className="g-about-ring g-about-ring-two" />
            <span className="g-about-mark-wrap"><Image src="/gdg-mark.png" alt="" width={132} height={132} priority /></span>
            <span className="g-about-code">&lt; / &gt;</span>
            <span className="g-about-chip chip-blue">CLOUD</span>
            <span className="g-about-chip chip-red">AI</span>
            <span className="g-about-chip chip-yellow">WEB</span>
            <span className="g-about-chip chip-green">OPEN SOURCE</span>
          </div>
        </section>

        <section className="g-section" aria-labelledby="impact-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">CHAPTER IMPACT</p>
              <h2 id="impact-title">Built by students, for students</h2>
            </div>
            <p className="g-section-copy">A learning community measured by the builders it helps ship, not by the slides it presents.</p>
          </div>
          <div className="g-impact-grid">
            {impactStats.map(({ value, label, detail, icon: Icon, tone }) => (
              <Tilt as="article" key={label} max={7} scale={1.02} className={`g-impact g-kpi-${tone}`}>
                <span className="g-impact-icon" aria-hidden="true"><Icon size={18} /></span>
                <strong>{value}</strong>
                <h3>{label}</h3>
                <p>{detail}</p>
              </Tilt>
            ))}
          </div>
        </section>

        <section className="g-section" aria-labelledby="pillars-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">CORE PILLARS</p>
              <h2 id="pillars-title">Four ways we build developers</h2>
            </div>
            <p className="g-section-copy">Every chapter activity maps back to one of these four pillars.</p>
          </div>
          <div className="g-pillar-grid">
            {pillars.map(({ title, detail, icon: Icon, tone, tags }, index) => (
              <Tilt as="article" key={title} max={8} scale={1.02} className={`g-pillar g-pillar-${tone}`}>
                <span className="g-pillar-index">0{index + 1}</span>
                <span className="g-pillar-icon" aria-hidden="true"><Icon size={20} /></span>
                <h3>{title}</h3>
                <p>{detail}</p>
                <span className="g-pillar-tags">
                  {tags.map((tag) => <span key={tag}>{tag}</span>)}
                </span>
              </Tilt>
            ))}
          </div>
        </section>

        <section className="g-section" aria-labelledby="highlights-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">FLAGSHIP MILESTONES</p>
              <h2 id="highlights-title">Highlights from the chapter</h2>
            </div>
            <p className="g-section-copy">Public chapter milestones that shaped the 2026 builder community.</p>
          </div>
          <div className="g-highlight-grid">
            {highlights.map(({ kicker, title, detail, icon: Icon, tone, href, link }, index) => (
              <article key={title} className={`g-highlight g-highlight-${tone}`}>
                <div className="g-highlight-top">
                  <span className="g-highlight-icon" aria-hidden="true"><Icon size={18} /></span>
                  <span className="g-highlight-index">0{index + 1}</span>
                </div>
                <p className="g-highlight-kicker">{kicker}</p>
                <h3>{title}</h3>
                <p className="g-highlight-detail">{detail}</p>
                <a href={href} target="_blank" rel="noreferrer">{link} <ArrowUpRight size={14} aria-hidden="true" /></a>
              </article>
            ))}
          </div>
        </section>

        <section className="g-section" aria-labelledby="team-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">2026–2027 ORGANIZING TEAM</p>
              <h2 id="team-title">The people behind the campaign</h2>
            </div>
            <p className="g-section-copy">Student organizers keeping the chapter learning, building, and shipping together.</p>
          </div>
          <div className="g-team-grid">
            {team.map(({ name, initials, role, focus, tone }) => (
              <Tilt as="article" key={name} max={9} scale={1.025} className={`g-team-card g-team-${tone}`}>
                <span className="g-team-ring" aria-hidden="true">
                  <span className="g-team-initials">{initials}</span>
                </span>
                <span className="g-team-badge">{role}</span>
                <h3>{name}</h3>
                <p>{focus}</p>
                <span className="g-team-foot"><Code2 size={13} aria-hidden="true" />GDGoC ACEIT · 2026–27</span>
              </Tilt>
            ))}
          </div>
        </section>

        <section className="g-section" aria-labelledby="links-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">OFFICIAL COMMUNITY LINKS</p>
              <h2 id="links-title">Stay connected</h2>
            </div>
            <p className="g-section-copy">Chapter resources, public updates, and the live campaign leaderboard.</p>
          </div>
          <div className="g-link-grid">
            {communityLinks.map(({ href, label, detail, icon: Icon }) => (
              <a key={href} className="g-link-card" href={href} target="_blank" rel="noreferrer">
                <span className="g-link-icon" aria-hidden="true"><Icon size={18} /></span>
                <span><strong>{label}</strong><small>{detail}</small></span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            ))}
            <Link className="g-link-card g-link-card-internal" href="/progress">
              <span className="g-link-icon" aria-hidden="true"><Trophy size={18} /></span>
              <span><strong>Campaign leaderboard</strong><small>Live participant progress for the 2026 Cloud &amp; AI campaign.</small></span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section className="g-cta-band" aria-labelledby="about-cta-title">
          <div>
            <p className="g-kicker">BUILD WITH US</p>
            <h2 id="about-cta-title">The next chapter is written by builders.</h2>
          </div>
          <div className="g-cta-actions">
            <Link className="g-btn g-btn-primary" href="/progress">Explore Leaderboard <ArrowRight size={16} aria-hidden="true" /></Link>
            <a className="g-btn g-btn-ghost" href="https://in.linkedin.com/company/gdg-aceit" target="_blank" rel="noreferrer">Connect on LinkedIn <ArrowUpRight size={16} aria-hidden="true" /></a>
          </div>
        </section>

        <CommunityFooter />
      </main>
    </div>
  );
}
