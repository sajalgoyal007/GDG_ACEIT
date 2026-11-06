export type VerificationStatus = "verified" | "pending" | "needs_review";

export interface BadgeRecord {
  id: string;
  name: string;
  verifiedAt: string;
  earnedAt?: string;
  status: VerificationStatus;
}

export interface Participant {
  id: string;
  participantKey?: string;
  displayName: string;
  initials: string;
  color: string;
  registrationStatus: "registered" | "pending";
  verifiedBadgeCount?: number;
  profileUrl?: string;
  badges: BadgeRecord[];
  lastCheckedAt?: string;
  verificationSource: string;
  audit: { id: string; message: string; at: string }[];
}

/** Public dashboard projection; excludes registration identifiers and audit notes. */
export interface PublicParticipant {
  id: string;
  displayName: string;
  initials: string;
  color: string;
  /** The DB initializes this to zero; lastCheckedAt distinguishes that default from a reviewed zero. */
  verifiedBadgeCount: number;
  /**
   * Skill Badge count drives the primary leaderboard rank.
   * null means classification data has not yet been imported for this participant.
   */
  skillBadgeCount: number | null;
  /**
   * Arcade Game Badge count is displayed separately; it does not affect primary rank.
   * null means classification data has not yet been imported for this participant.
   */
  arcadeGameBadgeCount: number | null;
  profileUrl?: string;
  lastCheckedAt?: string;
  verificationSource?: string;
  badges?: BadgeRecord[];
  /** Persisted rank captured exactly once when the participant reached 10 Skill Badges. */
  frozenRank?: number | null;
  /** Timestamp of the one-time frozen-rank capture. */
  rankFrozenAt?: string | null;
}

export interface LeaderboardSnapshot {
  dataMode: "demo" | "database";
  participants: PublicParticipant[];
  registeredCount: number;
  totalVerifiedBadges: number;
  totalSkillBadges: number;
  totalArcadeBadges: number;
  /** Participants whose 10-Skill-Badge rank has been captured. */
  frozenRankCount: number;
  /** Participants currently at or above 10 Skill Badges. */
  tenBadgeCount: number;
  lastSyncedAt: string;
}

export interface LeaderboardProvider {
  readonly name: string;
  /** Legacy provider helpers retained for existing integrations during migration. */
  getParticipants?(): Promise<Participant[]>;
  getLastSyncedAt?(): Promise<string>;
  getPublicSnapshot(): Promise<LeaderboardSnapshot>;
}
