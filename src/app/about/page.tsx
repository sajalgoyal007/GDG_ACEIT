import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Binary,
  Building2,
  Cloud,
  Code2,
  Gamepad2,
  Globe2,
  GraduationCap,
  MapPin,
  Palette,
  Rocket,
  Smartphone,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { CommunityFooter } from "@/components/community-footer";
import { CommunityNavigation } from "@/components/community-navigation";
import { GdgEmblem } from "@/components/gdg-emblem";
import { MobileGdgBadge } from "@/components/mobile-gdg-badge";
import { JaipurChapterBadge, JaipurHeritageBackdrop, JharokhaHalo } from "@/components/jaipur-heritage-backdrop";
import { Motion3DCard } from "@/components/motion-3d-card";

export const metadata: Metadata = {
  title: "About",
  description: "Meet GDG On Campus ACEIT — the student developer chapter at Arya College of Engineering & IT, Kukas, Jaipur — its organizers, domains, and flagship milestones.",
};

const impactStats = [
  { value: "195+", label: "Active student builders", detail: "Learning cloud, AI, and open-source engineering", icon: Users, tone: "blue" },
  { value: "395+", label: "Verified badges", detail: "Earned through the 2026 campaign", icon: BadgeCheck, tone: "red" },
  { value: "Tier 1", label: "Study Jams chapter", detail: "Top 5 national cohort recognition", icon: Trophy, tone: "yellow" },
  { value: "5", label: "Builder domains", detail: "Cloud, web, mobile, CP, and design", icon: Code2, tone: "green" },
] as const;

const team = [
  {
    name: "Sajal Goyal",
    initials: "SG",
    role: "Organizer",
    focus: "Campaign direction, partner coordination, and the chapter's cloud learning roadmap.",
    tone: "blue",
  },
  {
    name: "Shreya Soni",
    initials: "SS",
    role: "Organizer",
    focus: "Community operations, event experience, and peer learning circles.",
    tone: "red",
  },
  {
    name: "Shreyansh Gupta",
    initials: "SG",
    role: "Organizer",
    focus: "Technical programming, hackathon mentorship, and builder support.",
    tone: "green",
  },
] as const;

const domains = [
  {
    title: "Cloud & Generative AI",
    detail: "Hands-on Google Cloud paths, Gemini labs, and cohort study jams that turn curiosity into shipped skills.",
    icon: Cloud,
    tone: "blue",
    tags: ["Google Cloud", "Gemini", "Vertex AI", "BigQuery"],
  },
  {
    title: "Full-Stack Web Engineering",
    detail: "From interface to infrastructure — modern React and Node architectures built for production.",
    icon: Code2,
    tone: "red",
    tags: ["Next.js", "React", "Node.js", "TypeScript"],
  },
  {
    title: "Mobile & Flutter",
    detail: "Cross-platform products with Material 3 craft, tested on real devices and shipped by student teams.",
    icon: Smartphone,
    tone: "yellow",
    tags: ["Flutter", "Material 3", "Firebase"],
  },
  {
    title: "Competitive Programming & DSA",
    detail: "Weekly problem-solving circles, algorithmic thinking, and technical interview preparation.",
    icon: Binary,
    tone: "green",
    tags: ["DSA", "Contests", "Interview prep"],
  },
  {
    title: "UI/UX & Community Building",
    detail: "Design systems, campus hackathons, and peer mentorship that make the chapter feel like home.",
    icon: Palette,
    tone: "violet",
    tags: ["Design systems", "Hackathons", "Mentorship"],
  },
] as const;

const highlights = [
  {
    kicker: "LEARN · COHORT 1",
    title: "Google Cloud Study Jams — Tier 1 Chapter & Top 5 Ranking",
    detail: "Recognised on the national cohort leaderboard for campaign participation, completion, and verified builder outcomes.",
    icon: Cloud,
    tone: "blue",
    href: "https://gdg.community.dev/",
    link: "Explore GDG community",
    internal: false,
  },
  {
    kicker: "BUILD · 2026",
    title: "Google Cloud Learn with Communities 2026",
    detail: "195+ active student builders and 395+ verified badges — the chapter's largest coordinated learning campaign to date.",
    icon: BadgeCheck,
    tone: "green",
    href: "/progress",
    link: "View the live leaderboard",
    internal: true,
  },
  {
    kicker: "SHIP · CAMPUS",
    title: "TechSprint ACEIT Hackathon",
    detail: "A campus innovation sprint where teams scope, build, and pitch practical software for real engineering problems.",
    icon: Rocket,
    tone: "red",
    href: "https://in.linkedin.com/company/gdg-aceit",
    link: "See chapter updates",
    internal: false,
  },
  {
    kicker: "CONNECT · KUKAS",
    title: "Hack-Arya-Verse & AryaVerse",
    detail: "Flagship hackathons and developer fests at Arya Old Campus, Kukas, growing a shared builder culture across batches.",
    icon: Sparkles,
    tone: "yellow",
    href: "https://www.aryacollege.in/arya-event/arya-gdg-club",
    link: "Explore the campus club",
    internal: false,
  },
  {
    kicker: "WIN · TEAM MEDHA",
    title: "Student Builder Wins — Team Medha & Hackathon Champions",
    detail: "ACEIT builders taking first place in campus and inter-college hackathons, including Team Medha's championship finish.",
    icon: Trophy,
    tone: "green",
    href: "https://in.linkedin.com/company/gdg-aceit",
    link: "Read the community post",
    internal: false,
  },
] as const;

const communityLinks = [
  {
    href: "https://gdg.community.dev/",
    label: "GDG Community",
    detail: "Find GDG On Campus chapters and upcoming Google developer events.",
    icon: Globe2,
  },
  {
    href: "https://in.linkedin.com/company/gdg-aceit",
    label: "GDG ACEIT on LinkedIn",
    detail: "Chapter announcements, event recaps, and student builder wins.",
    icon: Users,
  },
  {
    href: "https://www.aryacollege.in/arya-event/arya-gdg-club",
    label: "Arya GDG Club",
    detail: "The chapter home at Arya College of Engineering & IT, Kukas.",
    icon: GraduationCap,
  },
  {
    href: "https://www.cloudskillsboost.google/",
    label: "Google Cloud Skills Boost",
    detail: "The learning platform behind Skill Badges and Arcade labs.",
    icon: Cloud,
  },
] as const;

export default function AboutPage() {
  return (
    <div className="g-app">
      <CommunityNavigation />
      <main className="g-main g-about-main">
        <section className="g-about-hero" aria-labelledby="about-title about-title-mobile">
          <JaipurHeritageBackdrop variant="about" />

          <div className="g-about-mobile">
            <div className="g-about-mobile-head">
              <MobileGdgBadge />
              <div className="g-about-mobile-copy">
                <JaipurChapterBadge className="g-about-badge" />
                <h1 id="about-title-mobile" className="g-about-mobile-heading">
                  <span>GDG On Campus</span>
                  <span>
                    <span className="g-wordmark" aria-hidden="true">
                      {"ACEIT".split("").map((letter, index) => <span key={`${letter}-${index}`}>{letter}</span>)}
                    </span>
                    <span className="sr-only">ACEIT</span>
                  </span>
                </h1>
              </div>
            </div>
            <p className="g-about-mobile-lede">
              <strong>Learn · Build · Connect</strong> at Arya College of Engineering &amp; IT, Kukas, Jaipur.
            </p>
            <div className="g-about-actions g-about-mobile-actions">
              <Link className="g-btn g-btn-primary" href="/progress">
                Explore the leaderboard
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a className="g-btn g-btn-ghost" href="https://gdg.community.dev/" target="_blank" rel="noreferrer">
                Visit GDG Community
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="g-about-copy">
            <p className="g-eyebrow"><span className="g-eyebrow-dot" />GDG ON CAMPUS <span>/</span> ARYA COLLEGE OF ENGINEERING &amp; IT</p>
            <JaipurChapterBadge className="g-about-badge" />
            <h1 id="about-title">
              GDG On Campus{" "}
              <span className="g-wordmark" aria-hidden="true">
                {"ACEIT".split("").map((letter, index) => <span key={`${letter}-${index}`}>{letter}</span>)}
              </span>
              <span className="sr-only">ACEIT</span>
            </h1>
            <p className="g-about-lede">
              <strong>Learn · Build · Connect</strong> with the student developer community at Arya College of Engineering &amp; IT in Kukas, Jaipur, Rajasthan — where campus curiosity becomes production-grade craft.
            </p>
            <div className="g-about-actions">
              <Link className="g-btn g-btn-primary" href="/progress">
                Explore the leaderboard
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a className="g-btn g-btn-ghost" href="https://gdg.community.dev/" target="_blank" rel="noreferrer">
                Visit GDG Community
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
            <div className="g-about-meta" aria-label="Chapter facts">
              <span className="g-about-fact"><MapPin size={13} aria-hidden="true" />Kukas, Jaipur · Rajasthan</span>
              <span className="g-about-fact"><GraduationCap size={13} aria-hidden="true" />Affiliated to RTU</span>
              <span className="g-about-fact"><Users size={13} aria-hidden="true" />Student-led chapter</span>
            </div>
          </div>

          <div className="g-about-visual">
            <JharokhaHalo />
            <GdgEmblem variant="compact" />
          </div>
        </section>

        <section className="g-section" aria-labelledby="impact-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">Chapter impact</p>
              <h2 id="impact-title">Built by students, for students</h2>
            </div>
            <p className="g-section-copy">A learning community measured by the builders it helps ship, not by the slides it presents.</p>
          </div>
          <div className="g-impact-grid">
            {impactStats.map(({ value, label, detail, icon: Icon, tone }) => (
              <Motion3DCard as="article" key={label} max={6} lift={10} className={`g-impact g-kpi-${tone}`}>
                <span className="g-impact-icon g-depth-2" aria-hidden="true"><Icon size={18} /></span>
                <strong>{value}</strong>
                <span className="g-impact-label">{label}</span>
                <p>{detail}</p>
              </Motion3DCard>
            ))}
          </div>
        </section>

        <section className="g-section" aria-labelledby="team-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">2026–2027 organizing team</p>
              <h2 id="team-title">The people behind the chapter</h2>
            </div>
            <p className="g-section-copy">Three student organizers keeping ACEIT learning, building, and shipping together.</p>
          </div>
          <div className="g-team-grid">
            {team.map(({ name, initials, role, focus, tone }, index) => (
              <Motion3DCard as="article" key={name} max={9} lift={16} className={`g-team-card g-team-${tone}`}>
                <span className="g-team-band" aria-hidden="true" />
                <div className="g-team-head">
                  <span className="g-team-ring g-depth-3" aria-hidden="true">
                    <span className="g-team-initials">{initials}</span>
                  </span>
                  <span className="g-team-heading">
                    <span className="g-team-badge">{role}</span>
                    <span className="g-team-id">GDGoC · ID {String(index + 1).padStart(2, "0")}</span>
                  </span>
                </div>
                <h3>{name}</h3>
                <p>{focus}</p>
                <span className="g-team-foot">
                  <span className="g-team-chip">2026–27 Organizing Team</span>
                  <Code2 size={13} aria-hidden="true" />
                </span>
              </Motion3DCard>
            ))}
          </div>
        </section>

        <section className="g-section" aria-labelledby="domains-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">Domains we work in</p>
              <h2 id="domains-title">Five tracks, one builder community</h2>
            </div>
            <p className="g-section-copy">Google technologies sit at the centre, surrounded by the engineering and design disciplines that make products real.</p>
          </div>
          <div className="g-domain-grid">
            {domains.map(({ title, detail, icon: Icon, tone, tags }, index) => (
              <Motion3DCard as="article" key={title} max={7} lift={12} className={`g-domain-card g-domain-${tone}`}>
                <div className="g-domain-top">
                  <span className="g-domain-icon g-depth-2" aria-hidden="true"><Icon size={19} /></span>
                  <span className="g-domain-index">{String(index + 1).padStart(2, "0")}</span>
                </div>
                <h3>{title}</h3>
                <p>{detail}</p>
                <span className="g-domain-tags">
                  {tags.map((tag) => <span key={tag}>{tag}</span>)}
                </span>
              </Motion3DCard>
            ))}
          </div>
        </section>

        <section className="g-section" aria-labelledby="highlights-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">Flagship highlights</p>
              <h2 id="highlights-title">Milestones that shaped the chapter</h2>
            </div>
            <p className="g-section-copy">Public chapter milestones from the 2026 campaign and the campus developer culture behind them.</p>
          </div>
          <div className="g-highlight-grid">
            {highlights.map(({ kicker, title, detail, icon: Icon, tone, href, link, internal }) => (
              <Motion3DCard as="article" key={title} max={6} lift={12} className={`g-highlight g-highlight-${tone}`}>
                <div className="g-highlight-top">
                  <span className="g-highlight-icon g-depth-2" aria-hidden="true"><Icon size={18} /></span>
                  <span className="g-highlight-kicker">{kicker}</span>
                </div>
                <h3>{title}</h3>
                <p className="g-highlight-detail">{detail}</p>
                {internal
                  ? <Link href={href}>{link} <ArrowRight size={14} aria-hidden="true" /></Link>
                  : <a href={href} target="_blank" rel="noreferrer">{link} <ArrowUpRight size={14} aria-hidden="true" /></a>}
              </Motion3DCard>
            ))}
          </div>
        </section>

        <section className="g-section" aria-labelledby="campus-title">
          <div className="g-campus-card">
            <div className="g-campus-copy">
              <p className="g-kicker">The campus</p>
              <h2 id="campus-title">About Arya College of Engineering &amp; IT, Jaipur</h2>
              <p>
                ACEIT is the Kukas, Jaipur campus of the Arya Group of Colleges, affiliated with Rajasthan Technical University (RTU). Its student developer culture runs on coding clubs, peer study groups, and an innovation ecosystem that gives builders room to experiment, ship, and present their work. GDG On Campus ACEIT is the student-led chapter connecting that campus energy to Google&apos;s developer ecosystem.
              </p>
              <div className="g-campus-facts">
                <span className="g-campus-fact"><MapPin size={12} aria-hidden="true" />Kukas, Jaipur</span>
                <span className="g-campus-fact"><GraduationCap size={12} aria-hidden="true" />RTU affiliated</span>
                <span className="g-campus-fact"><Building2 size={12} aria-hidden="true" />Arya Group of Colleges</span>
                <span className="g-campus-fact"><Gamepad2 size={12} aria-hidden="true" />Hackathons &amp; devfests</span>
              </div>
              <a className="g-campus-link" href="https://www.aryacollege.in/arya-event/arya-gdg-club" target="_blank" rel="noreferrer">
                Explore the ACEIT campus club <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </div>
            <div className="g-campus-visual">
              <span className="g-campus-plate">
                <Image className="g-campus-mark" src="/gdg-mark.png" alt="" width={56} height={56} />
                <strong>ACEIT</strong>
                <span>KUKAS · JAIPUR · RTU</span>
              </span>
            </div>
          </div>
        </section>

        <section className="g-section" aria-labelledby="links-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">Official community links</p>
              <h2 id="links-title">Stay connected</h2>
            </div>
            <p className="g-section-copy">Chapter resources, public updates, and the live campaign leaderboard — all in one place.</p>
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
            <p className="g-kicker">Build with us</p>
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
