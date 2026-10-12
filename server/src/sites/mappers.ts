import type { DeviceStatus, JoinCode, Member, MembershipStatus, MySite, Profile, SiteRole } from "../shared/api";
import type { Lang } from "../shared/languages";

// DB 행 → 앱과 공유하는 응답 형식 (server/src/shared/api.ts)

type ProfileRow = { id: string; email: string; displayName: string; preferredLang: string; autoPlay: boolean; speechRate: number };

export const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  email: row.email,
  displayName: row.displayName,
  preferredLang: row.preferredLang as Lang,
  autoPlay: row.autoPlay,
  speechRate: Math.round(row.speechRate * 100) / 100,
});

type SiteRow = { id: string; name: string; address: string | null; status: string };

export const toMySite = (site: SiteRow, membership: { role: string; status: string }, memberCount: number): MySite => ({
  id: site.id,
  name: site.name,
  address: site.address,
  status: site.status as MySite["status"],
  role: membership.role as SiteRole,
  membershipStatus: membership.status as MembershipStatus,
  memberCount,
});

type MemberRow = {
  userId: string;
  role: string;
  status: string;
  langOverride: string | null;
  user: { displayName: string; preferredLang: string };
};

export const toMember = (row: MemberRow, online: boolean, device: DeviceStatus | null): Member => ({
  userId: row.userId,
  displayName: row.user.displayName,
  role: row.role as SiteRole,
  status: row.status as MembershipStatus,
  lang: (row.langOverride ?? row.user.preferredLang) as Lang,
  online,
  device: online ? device : null,
});

type CodeRow = { id: string; code: string; expiresAt: Date | null; maxUses: number | null; useCount: number };

export const qrPayloadOf = (code: string) => `syncrew://join?code=${code}`;

export const toJoinCode = (row: CodeRow): JoinCode => ({
  id: row.id,
  code: row.code,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  maxUses: row.maxUses,
  useCount: row.useCount,
  qrPayload: qrPayloadOf(row.code),
});
