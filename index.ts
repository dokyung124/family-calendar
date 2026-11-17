// =============================================
// 가족캘린더 : 알림 함수 (Supabase Edge Function, 이름: notify)
//
//  slot = "morning" (매일 오전 10시)
//    - [가족 일정 알림] 켠 사람 : 오늘 시작하는 가족 일정 전부 (누구 일정인지 표시)
//    - [청약 마감 알림] 켠 사람 : 오늘 청약 마감 종목 (상세 내용)
//  slot = "evening" (매일 밤 10시)
//    - [상장 알림] 켠 사람 : 내일 상장 종목 (상세 내용)
//  앱의 [테스트 알림] : 누른 사람에게만, 본인 알림 설정대로 위 내용을 한 번에 보냄
//
//  실행될 때마다 공모주 구글 캘린더를 읽어 ipo_events 표를 새로 채워요 (앱에 흐리게 표시용).
//
// 필요한 Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET,
//                 IPO_CLOSING_ICS_URL (청약 캘린더), IPO_LISTING_ICS_URL (상장 캘린더)
// =============================================
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
// 공모주 구글 캘린더 iCal 주소 (청약 / 상장). 예전 이름 IPO_ICS_URL 도 받아줌
const IPO_SOURCES: { url: string; kind?: "closing" | "listing" }[] = [
  { url: Deno.env.get("IPO_CLOSING_ICS_URL") ?? "", kind: "closing" as const },
  { url: Deno.env.get("IPO_LISTING_ICS_URL") ?? "", kind: "listing" as const },
  { url: Deno.env.get("IPO_ICS_URL") ?? "" },
].filter((s) => s.url.trim());

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:family@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---- ICS START (공모주 캘린더 읽기) ----
export type IpoEvent = { kind: "closing" | "listing"; name: string; detail: string; event_date: string };

/** 한국 시간 기준 오늘 날짜 "YYYY-MM-DD" */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ICS 날짜 값 → { date: 한국 날짜, midnight: 0시 정각 여부, dateOnly } */
function parseIcsDate(prop: string, value: string) {
  const v = value.trim();
  const dateOnly = /VALUE=DATE(?!-)/.test(prop) || /^\d{8}$/.test(v);
  const y = v.slice(0, 4), m = v.slice(4, 6), d = v.slice(6, 8);
  if (dateOnly) return { date: `${y}-${m}-${d}`, midnight: true, dateOnly: true };
  const hh = v.slice(9, 11) || "00", mi = v.slice(11, 13) || "00", ss = v.slice(13, 15) || "00";
  if (v.endsWith("Z")) {
    const t = new Date(`${y}-${m}-${d}T${hh}:${mi}:${ss}Z`);
    const k = new Date(t.getTime() + 9 * 3600 * 1000).toISOString();
    return { date: k.slice(0, 10), midnight: k.slice(11, 19) === "00:00:00", dateOnly: false };
  }
  // TZID 가 있거나 시간대 표시가 없으면 한국 시간으로 간주
  return { date: `${y}-${m}-${d}`, midnight: `${hh}${mi}${ss}` === "000000", dateOnly: false };
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}

const TAG = /^\s*[\(\[]\s*([^\)\]]{1,10}?)\s*[\)\]]\s*/; // 맨 앞의 (청약) [상장] (권리공매도) 같은 표시
const stripTag = (s: string) => s.replace(TAG, "").trim();

/** "(청약) 동원파츠 - 삼성 (23,000)" → "동원파츠(삼성)" */
export function cleanName(summary: string): string {
  let s = stripTag(summary);
  s = s.replace(/\s*\([^()]*\)?\s*$/, "").trim(); // 끝의 (숫자 등) 제거
  const parts = s.split(/\s+-\s+/);
  if (parts.length >= 2) return `${parts[0].trim()}(${parts.slice(1).join(" - ").trim()})`;
  return s;
}

/** ICS 전체 텍스트 → 청약 마지막 날 / 상장일 목록 (권리공매도 등은 제외)
 *  제목 앞 표시가 (청약)/(상장)이면 그대로 따르고, 다른 표시면 제외,
 *  표시가 없으면 어느 캘린더에서 왔는지(defaultKind)로 정해요. */
export function parseIpoEvents(ics: string, defaultKind?: "closing" | "listing"): IpoEvent[] {
  const text = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, ""); // 접힌 줄 펴기
  const out = new Map<string, IpoEvent>();

  for (const block of text.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const props: Record<string, { prop: string; value: string }> = {};
    for (const line of body.split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const prop = line.slice(0, idx);
      const key = prop.split(";")[0].toUpperCase();
      if (!props[key]) props[key] = { prop, value: line.slice(idx + 1) };
    }
    if (!props.SUMMARY || !props.DTSTART) continue;
    if ((props.STATUS?.value ?? "").trim().toUpperCase() === "CANCELLED") continue;

    const summary = unescapeText(props.SUMMARY.value);
    const tag = summary.match(TAG)?.[1]?.trim();
    const kind = tag === "청약" ? "closing" : tag === "상장" ? "listing" : tag ? undefined : defaultKind;
    if (!kind) continue; // 권리공매도 등
    const isSub = kind === "closing";

    const start = parseIcsDate(props.DTSTART.prop, props.DTSTART.value);
    let lastDay = start.date;
    if (props.DTEND) {
      const end = parseIcsDate(props.DTEND.prop, props.DTEND.value);
      lastDay = end.date;
      // 종료값은 "그 다음 날 0시"로 저장되는 경우가 많음 → 하루 빼기
      if ((end.dateOnly || end.midnight) && end.date > start.date) lastDay = addDays(end.date, -1);
    }

    // 알림용 상세 내용: "(청약)" 표시만 떼고 원래 제목 그대로 (예: "동원파츠 - 삼성 (23,000)")
    const detail = stripTag(summary);
    const ev: IpoEvent = isSub
      ? { kind: "closing", name: cleanName(summary), detail, event_date: lastDay }
      : { kind: "listing", name: cleanName(summary), detail, event_date: start.date };
    out.set(`${ev.kind}|${ev.name}|${ev.event_date}`, ev);
  }
  return [...out.values()];
}
// ---- ICS END ----

type Db = ReturnType<typeof createClient>;

/** 구글 캘린더를 읽어 ipo_events 표를 새로 채움. 실패하면 표에 있던 걸 그대로 사용 */
async function syncIpo(db: Db): Promise<{ list: IpoEvent[]; synced: boolean }> {
  if (IPO_SOURCES.length) {
    try {
      // 두 캘린더 모두 읽혀야 표를 새로 채움 (하나라도 실패하면 저장된 일정 사용)
      const parts = await Promise.all(IPO_SOURCES.map(async (src) => {
        const res = await fetch(src.url.trim());
        if (!res.ok) throw new Error(`ICS ${res.status} (${src.kind ?? "공모주"} 캘린더)`);
        return parseIpoEvents(await res.text(), src.kind);
      }));
      const seen = new Set<string>();
      const list = parts.flat().filter((e) => {
        const k = `${e.kind}|${e.name}|${e.event_date}`;
        return seen.has(k) ? false : (seen.add(k), true);
      });
      const del = await db.from("ipo_events").delete().gte("id", 0);
      if (del.error) throw del.error;
      for (let i = 0; i < list.length; i += 500) {
        const ins = await db.from("ipo_events").insert(list.slice(i, i + 500));
        if (ins.error) throw ins.error;
      }
      return { list, synced: true };
    } catch (e) {
      console.error("공모주 캘린더를 읽지 못했어요 (저장된 일정 사용):", e);
    }
  }
  const { data } = await db.from("ipo_events").select("kind,name,detail,event_date");
  return { list: (data ?? []) as IpoEvent[], synced: false };
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
function dateLabel(ymd: string) {
  const d = new Date(ymd + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEK[d.getUTCDay()]})`;
}

type Ev = { title: string; start_time: string | null; owner_id: string };
type Profile = { id: string; name: string; alert_events: boolean; alert_closing: boolean; alert_listing: boolean };

function eventLines(events: Ev[], names: Map<string, string>): string[] {
  return [...events]
    .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""))
    .map((e) => `• ${names.get(e.owner_id) ?? "?"} · ${e.title}${e.start_time ? " " + e.start_time.slice(0, 5) : ""}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  // 누가 불렀는지: 예약 실행이면 가족 전체, 앱의 [테스트 알림]이면 본인만
  let onlyUser: string | null = null;
  const isCron = CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
  if (!isCron) {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data } = await db.auth.getUser(token);
    if (!data?.user) return json({ error: "권한이 없어요" }, 401);
    onlyUser = data.user.id;
  }
  const body = await req.json().catch(() => ({}));
  const slot: string = onlyUser ? "test" : body.slot === "evening" ? "evening" : "morning";

  const today = kstToday();
  const tomorrow = addDays(today, 1);
  const ipo = await syncIpo(db);
  const detailOf = (e: IpoEvent) => `· ${e.detail || e.name}`;
  const closingToday = ipo.list.filter((e) => e.kind === "closing" && e.event_date === today).map(detailOf);
  const listingTomorrow = ipo.list.filter((e) => e.kind === "listing" && e.event_date === tomorrow).map(detailOf);

  const { data: profiles } = await db.from("profiles").select("id,name,alert_events,alert_closing,alert_listing");
  const people = new Map<string, Profile>((profiles ?? []).map((p: Profile) => [p.id, p]));
  const names = new Map([...people.values()].map((p) => [p.id, p.name]));

  let todayEvents: Ev[] = [];
  if (slot !== "evening") {
    const { data, error } = await db.from("events")
      .select("title,start_time,owner_id").eq("event_date", today);
    if (error) return json({ error: error.message }, 500);
    todayEvents = data ?? [];
  }
  const famLines = eventLines(todayEvents, names);

  let subQuery = db.from("push_subscriptions").select("*");
  if (onlyUser) subQuery = subQuery.eq("user_id", onlyUser);
  const { data: subs, error: subErr } = await subQuery;
  if (subErr) return json({ error: subErr.message }, 500);

  let sent = 0, skipped = 0, removed = 0;
  for (const s of subs ?? []) {
    const p = people.get(s.user_id);
    const wantEvents = p?.alert_events !== false, wantClosing = p?.alert_closing === true, wantListing = p?.alert_listing === true;
    let title = "", lines: string[] = [];

    if (slot === "evening") {
      if (!wantListing || !listingTomorrow.length) { skipped++; continue; }
      title = `📈 내일 상장 · ${dateLabel(tomorrow)}`;
      lines = listingTomorrow;
    } else {
      const ev = wantEvents ? famLines : [];
      const cl = wantClosing ? closingToday : [];
      const li = slot === "test" && wantListing ? listingTomorrow : [];
      if (ev.length) lines.push(...ev);
      if (cl.length) lines.push(ev.length ? "📌 오늘 청약 마감" : "", ...cl);
      if (li.length) lines.push("📈 내일 상장", ...li);
      lines = lines.filter(Boolean);
      title = ev.length || !cl.length ? `오늘의 일정 · ${dateLabel(today)}` : `📌 오늘 청약 마감 · ${dateLabel(today)}`;
      if (slot === "test") {
        if (!lines.length) lines = ["오늘은 알려드릴 일정이 없어요.", "마이페이지 알림 설정대로 이렇게 알려드릴게요 🙂"];
        title = "🔔 테스트 · " + title;
      } else if (!lines.length) { skipped++; continue; } // 알릴 게 없는 날은 안 보냄
    }

    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body: lines.join("\n"), url: "./" }),
        { TTL: 6 * 3600, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { // 알림 해제·앱 삭제된 기기
        await db.from("push_subscriptions").delete().eq("id", s.id);
        removed++;
      } else {
        console.error("발송 실패", code, (e as Error).message);
      }
    }
  }

  return json({ slot, today, ipoSynced: ipo.synced, ipoCount: ipo.list.length, closingToday, listingTomorrow, sent, skipped, removed });
});
