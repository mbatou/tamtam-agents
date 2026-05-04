import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAuthorisedDashboardRequest } from "@/lib/dashboard-auth";
import type { PostStatus } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUSES: ReadonlyArray<PostStatus> = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "scheduled",
  "published",
  "failed",
];

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!isAuthorisedDashboardRequest(req)) {
    return new NextResponse("not found", { status: 404 });
  }

  let body: { status?: string };
  try {
    body = (await req.json()) as { status?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (
    !body.status ||
    !ALLOWED_STATUSES.includes(body.status as PostStatus)
  ) {
    return NextResponse.json(
      { error: `invalid status: ${body.status}` },
      { status: 400 },
    );
  }

  const { data, error } = await getSupabaseAdmin()
    .from("posts")
    .update({ status: body.status as PostStatus })
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ post: data });
}
