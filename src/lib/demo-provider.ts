import type { LeaderboardProvider, Participant } from "./types";
import { hasMilestone } from "./leaderboard";

// Synthetic records for interface development. No records represent real participants.
const demoParticipants: Participant[] = [
  { id: "demo-001", displayName: "Demo Learner 01", initials: "D1", color: "blue", registrationStatus: "registered", lastCheckedAt: "2026-10-26T08:42:00+05:30", verificationSource: "Demo provider", badges: ["Get Started with Cloud Shell and gcloud", "Google Cloud Fundamentals: Core Infrastructure", "Create and Manage Cloud Resources", "Perform Foundational Infrastructure Tasks in Google Cloud", "Set Up and Configure a Cloud Environment in Google Cloud", "Build and Secure Networks in Google Cloud", "Deploy and Manage Cloud Environments with Google Cloud", "Automate Deployment and Manage Cloud Environments", "Develop Your Google Cloud Network", "Implement DevOps Workflows in Google Cloud", "Monitor and Log with Google Cloud Observability"].map((name, i) => ({ id: `demo-001-badge-${i + 1}`, name, verifiedAt: `2026-10-${String(25 - Math.floor(i / 4)).padStart(2, "0")}T${String(11 + (i % 8)).padStart(2, "0")}:20:00+05:30`, status: "verified" as const })), audit: [{ id: "a1", message: "11 badge records verified by demo provider", at: "2026-10-26T08:42:00+05:30" }, { id: "a2", message: "No public profile link provided in this demo fixture", at: "2026-10-24T10:10:00+05:30" }] },
  { id: "demo-002", displayName: "Demo Learner 02", initials: "D2", color: "coral", registrationStatus: "registered", lastCheckedAt: "2026-10-26T08:42:00+05:30", verificationSource: "Demo provider", badges: ["Google Cloud Fundamentals: Core Infrastructure", "Create and Manage Cloud Resources", "Perform Foundational Infrastructure Tasks in Google Cloud", "Set Up and Configure a Cloud Environment in Google Cloud", "Build and Secure Networks in Google Cloud", "Develop Your Google Cloud Network"].map((name, i) => ({ id: `demo-002-badge-${i + 1}`, name, verifiedAt: `2026-10-${String(24 - Math.floor(i / 3)).padStart(2, "0")}T13:20:00+05:30`, status: "verified" as const })), audit: [{ id: "m1", message: "6 badge records verified by demo provider", at: "2026-10-26T08:42:00+05:30" }] },
  { id: "demo-003", displayName: "Demo Learner 03", initials: "D3", color: "green", registrationStatus: "registered", lastCheckedAt: "2026-10-26T08:42:00+05:30", verificationSource: "Demo provider", badges: ["Get Started with Cloud Shell and gcloud", "Google Cloud Fundamentals: Core Infrastructure", "Create and Manage Cloud Resources", "Perform Foundational Infrastructure Tasks in Google Cloud", "Set Up and Configure a Cloud Environment in Google Cloud"].map((name, i) => ({ id: `demo-003-badge-${i + 1}`, name, verifiedAt: `2026-10-${String(23 + (i % 3)).padStart(2, "0")}T10:00:00+05:30`, status: "verified" as const })), audit: [{ id: "v1", message: "5 badge records verified by demo provider", at: "2026-10-26T08:42:00+05:30" }] },
  { id: "demo-004", displayName: "Demo Learner 04", initials: "D4", color: "purple", registrationStatus: "registered", lastCheckedAt: "2026-10-26T08:42:00+05:30", verificationSource: "Demo provider", badges: ["Google Cloud Fundamentals: Core Infrastructure", "Create and Manage Cloud Resources", "Perform Foundational Infrastructure Tasks in Google Cloud", "Set Up and Configure a Cloud Environment in Google Cloud"].map((name, i) => ({ id: `demo-004-badge-${i + 1}`, name, verifiedAt: `2026-10-${String(22 + i).padStart(2, "0")}T12:00:00+05:30`, status: "verified" as const })), audit: [{ id: "an1", message: "4 badge records verified by demo provider", at: "2026-10-26T08:42:00+05:30" }] },
  { id: "demo-005", displayName: "Demo Learner 05", initials: "D5", color: "yellow", registrationStatus: "registered", lastCheckedAt: "2026-10-26T08:42:00+05:30", verificationSource: "Demo provider", badges: ["Get Started with Cloud Shell and gcloud", "Google Cloud Fundamentals: Core Infrastructure", "Create and Manage Cloud Resources"].map((name, i) => ({ id: `demo-005-badge-${i + 1}`, name, verifiedAt: `2026-10-${String(22 + i).padStart(2, "0")}T10:00:00+05:30`, status: "verified" as const })), audit: [{ id: "i1", message: "3 badge records verified by demo provider", at: "2026-10-26T08:42:00+05:30" }] },
  { id: "demo-006", displayName: "Demo Learner 06", initials: "D6", color: "coral", registrationStatus: "registered", lastCheckedAt: "2026-10-25T17:14:00+05:30", verificationSource: "Demo provider", badges: ["Google Cloud Fundamentals: Core Infrastructure", "Create and Manage Cloud Resources"].map((name, i) => ({ id: `demo-006-badge-${i + 1}`, name, verifiedAt: `2026-10-${String(20 + i).padStart(2, "0")}T10:00:00+05:30`, status: "verified" as const })), audit: [{ id: "d1", message: "2 badge records verified by demo provider", at: "2026-10-25T17:14:00+05:30" }] },
  { id: "demo-007", displayName: "Demo Learner 07", initials: "D7", color: "green", registrationStatus: "registered", lastCheckedAt: "2026-10-25T17:14:00+05:30", verificationSource: "Demo provider", badges: [{ id: "demo-007-badge-1", name: "Google Cloud Fundamentals: Core Infrastructure", verifiedAt: "2026-10-21T10:00:00+05:30", status: "verified" }], audit: [{ id: "demo-007-badge-1", message: "1 badge record verified by demo provider", at: "2026-10-25T17:14:00+05:30" }] },
  { id: "demo-008", displayName: "Demo Learner 08", initials: "D8", color: "blue", registrationStatus: "pending", lastCheckedAt: "2026-10-24T12:30:00+05:30", verificationSource: "Demo provider", badges: [], audit: [{ id: "s1", message: "Registration awaiting review", at: "2026-10-24T12:30:00+05:30" }] },
];

const DEMO_LAST_SYNCED_AT = "2026-10-26T08:42:00+05:30";

export const demoProvider: LeaderboardProvider = {
  name: "Demo provider",
  async getParticipants() { return demoParticipants; },
  async getLastSyncedAt() { return DEMO_LAST_SYNCED_AT; },
  async getPublicSnapshot() {
    const registered = demoParticipants.filter((participant) => participant.registrationStatus === "registered");
    const participants = registered.map((participant) => ({
      id: participant.id,
      displayName: participant.displayName,
      initials: participant.initials,
      color: participant.color,
      verifiedBadgeCount: participant.badges.filter((badge) => badge.status === "verified").length,
      ...(participant.profileUrl ? { profileUrl: participant.profileUrl } : {}),
      ...(participant.lastCheckedAt ? { lastCheckedAt: participant.lastCheckedAt } : {}),
      verificationSource: participant.verificationSource,
      badges: participant.badges,
    }));
    const totalVerifiedBadges = participants.reduce((sum, participant) => sum + participant.verifiedBadgeCount, 0);
    return {
      dataMode: "demo" as const,
      participants,
      registeredCount: registered.length,
      totalVerifiedBadges,
      fiveBadgeCount: participants.filter((participant) => hasMilestone(participant.verifiedBadgeCount, 5)).length,
      tenBadgeCount: participants.filter((participant) => hasMilestone(participant.verifiedBadgeCount, 10)).length,
      lastSyncedAt: DEMO_LAST_SYNCED_AT,
    };
  },
};



