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
  verifiedBadgeCount: number;
  profileUrl?: string;
  lastCheckedAt?: string;
  verificationSource?: string;
  badges?: BadgeRecord[];
}

export interface LeaderboardSnapshot {
  dataMode: "demo" | "database";
  participants: PublicParticipant[];
  registeredCount: number;
  totalVerifiedBadges: number;
  fiveBadgeCount: number;
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
