import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";

// GET — return all custom categories (those not in the hardcoded list)
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_photo_categories")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ categories: data ?? [] });
}

// POST — save a new custom category (idempotent, ignores duplicates)
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await req.json();
  const trimmed = name?.trim();
  if (!trimmed) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  // Skip if already in the hardcoded list
  if ((PHOTO_CATEGORIES as readonly string[]).includes(trimmed)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Upsert — safe to call multiple times with the same name
  const { error } = await supabase
    .from("custom_photo_categories")
    .upsert({ name: trimmed }, { onConflict: "name" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE — admin only
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

  const { error } = await supabase
    .from("custom_photo_categories")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
