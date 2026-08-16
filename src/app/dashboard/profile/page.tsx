"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import HelpTip from "@/components/HelpTip";
import EnableNotifications from "@/components/EnableNotifications";

interface ProfileData {
  first_name: string;
  last_name: string;
  display_email: string;
  phone: string;
  notify_on_view: boolean;
  email_opt_out: boolean;
}

interface BrokerData {
  brokerage_name: string;
  brokerage_address: string;
  brokerage_city: string;
  brokerage_state: string;
  brokerage_zip: string;
  brokerage_website: string;
  license_number: string;
  bio: string;
}

interface Assistant {
  assistant_id: string;
  profiles: {
    first_name: string | null;
    last_name: string | null;
    display_email: string | null;
  } | null;
}

export default function ProfilePage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<string>("broker");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [profile, setProfile] = useState<ProfileData>({ first_name: "", last_name: "", display_email: "", phone: "", notify_on_view: true, email_opt_out: false });
  const [broker, setBroker] = useState<BrokerData>({ brokerage_name: "", brokerage_address: "", brokerage_city: "", brokerage_state: "", brokerage_zip: "", brokerage_website: "", license_number: "", bio: "" });
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [newLoginEmail, setNewLoginEmail] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: p } = await supabase.from("profiles").select("first_name, last_name, display_email, phone, role, notify_on_view, email_opt_out").eq("id", user.id).single();
    const { data: b } = await supabase.from("broker_details").select("brokerage_name, brokerage_address, brokerage_city, brokerage_state, brokerage_zip, brokerage_website, license_number, bio, logo_url").eq("id", user.id).single();
    const { data: a } = await supabase.from("broker_assistants").select("assistant_id, profiles:assistant_id (first_name, last_name, display_email)").eq("broker_id", user.id);
    if (p) {
      setProfile({ first_name: p.first_name ?? "", last_name: p.last_name ?? "", display_email: p.display_email ?? "", phone: p.phone ?? "", notify_on_view: p.notify_on_view ?? true, email_opt_out: p.email_opt_out ?? false });
      setRole(p.role ?? "broker");
    }
    if (b) {
      setBroker({ brokerage_name: b.brokerage_name ?? "", brokerage_address: b.brokerage_address ?? "", brokerage_city: b.brokerage_city ?? "", brokerage_state: b.brokerage_state ?? "", brokerage_zip: b.brokerage_zip ?? "", brokerage_website: b.brokerage_website ?? "", license_number: b.license_number ?? "", bio: b.bio ?? "" });
      setLogoUrl(b.logo_url ?? null);
    }
    if (a) setAssistants(a as unknown as Assistant[]);
    setLoading(false);
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    setMessage(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/logo/upload", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) { setMessage({ type: "error", text: data.error ?? "Upload failed. Please try again." }); }
    else { setLogoUrl(data.url); setMessage({ type: "success", text: "Logo uploaded successfully." }); }
    setUploadingLogo(false);
  }

  async function removeLogo() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("broker_details").update({ logo_url: null }).eq("id", user.id);
    setLogoUrl(null);
    setMessage({ type: "success", text: "Logo removed." });
  }

  async function saveProfile() {
    setSaving(true);
    setMessage(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error: e1 } = await supabase.from("profiles").update({ ...profile, updated_at: new Date().toISOString() }).eq("id", user.id);
    const { error: e2 } = role === "broker"
      ? await supabase.from("broker_details").update({ ...broker, updated_at: new Date().toISOString() }).eq("id", user.id)
      : { error: null };
    if (e1 || e2) { setMessage({ type: "error", text: "Something went wrong. Please try again." }); }
    else { setMessage({ type: "success", text: "Profile saved successfully." }); }
    setSaving(false);
  }

  async function toggleViewAlerts(next: boolean) {
    setProfile((prev) => ({ ...prev, notify_on_view: next }));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("profiles").update({ notify_on_view: next }).eq("id", user.id);
  }

  // "Receive product news" is the inverse of the email_opt_out flag.
  async function toggleProductEmails(receive: boolean) {
    setProfile((prev) => ({ ...prev, email_opt_out: !receive }));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("profiles").update({ email_opt_out: !receive }).eq("id", user.id);
  }

  async function changeLoginEmail() {
    if (!newLoginEmail) return;
    setChangingEmail(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ email: newLoginEmail });
    if (error) { setMessage({ type: "error", text: error.message }); }
    else { setMessage({ type: "success", text: "Confirmation sent to " + newLoginEmail + ". Check your inbox to complete the change." }); setNewLoginEmail(""); }
    setChangingEmail(false);
  }

  async function changePassword() {
    if (!newPassword || newPassword.length < 8) { setMessage({ type: "error", text: "Password must be at least 8 characters." }); return; }
    if (newPassword !== confirmPassword) { setMessage({ type: "error", text: "Passwords don't match." }); return; }
    setChangingPassword(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { setMessage({ type: "error", text: error.message }); }
    else { setMessage({ type: "success", text: "Password updated successfully." }); setNewPassword(""); setConfirmPassword(""); }
    setChangingPassword(false);
  }

  async function removeAssistant(assistantId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("broker_assistants").delete().eq("broker_id", user.id).eq("assistant_id", assistantId);
    setAssistants((prev) => prev.filter((a) => a.assistant_id !== assistantId));
  }

  async function inviteAssistant() {
    if (!inviteEmail) return;
    setInviting(true);
    setMessage(null);
    const { data: found } = await supabase.from("profiles").select("id, first_name, last_name, display_email").eq("display_email", inviteEmail).eq("role", "assistant").single();
    if (!found) { setMessage({ type: "error", text: "No assistant account found with that email. They must sign up first." }); setInviting(false); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("broker_assistants").insert({ broker_id: user.id, assistant_id: found.id });
    if (error && error.code !== "23505") { setMessage({ type: "error", text: "Could not add assistant." }); }
    else { setAssistants((prev) => [...prev, { assistant_id: found.id, profiles: { first_name: found.first_name, last_name: found.last_name, display_email: found.display_email } }]); setInviteEmail(""); setMessage({ type: "success", text: "Assistant linked to your account." }); }
    setInviting(false);
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="text-ink-400 text-sm">Loading...</div></div>;

  const isAssistant = role === "assistant";
  const inputClass = "w-full bg-white border border-hairline-strong text-ink-900 placeholder:text-ink-400 rounded-ctl px-4 py-2.5 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40 transition-colors duration-fast ease-quiet";
  const labelClass = "block label-caps mb-1.5";
  const inkButtonClass = "bg-ink-950 hover:bg-ink-800 disabled:opacity-40 disabled:pointer-events-none text-white text-sm font-medium rounded-ctl transition-colors duration-fast ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2";

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-8 pb-6 border-b border-hairline">
        <h1 className="text-display text-ink-900">My Profile</h1>
        <p className="text-ink-500 mt-1 text-sm">Keep your contact info up to date.</p>
      </div>

      <div className="mb-5">
        <EnableNotifications />
      </div>

      {message && (
        <div className={`mb-6 px-4 py-3 rounded-card border text-sm ${message.type === "success" ? "bg-success-50 border-success-200 text-success-700" : "bg-danger-50 border-danger-200 text-danger-600"}`}>
          {message.text}
        </div>
      )}

      {/* Personal Info */}
      <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 mb-5">
        <h2 className="text-h2 text-ink-900 mb-5">Personal Information</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>First Name</label>
            <input className={inputClass} value={profile.first_name} onChange={(e) => setProfile({ ...profile, first_name: e.target.value })} placeholder="Jane" />
          </div>
          <div>
            <label className={labelClass}>Last Name</label>
            <input className={inputClass} value={profile.last_name} onChange={(e) => setProfile({ ...profile, last_name: e.target.value })} placeholder="Smith" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="label-caps">Contact Email</label>
              <HelpTip
                text={isAssistant ? "Your contact email — may not be the same as your login email." : "Shown to YachtPics. Separate from your login email."}
                detail="To change the email you use to sign in, scroll to the bottom of this page."
                position="below"
                width={270}
              />
            </div>
            <input className={inputClass} type="email" value={profile.display_email} onChange={(e) => setProfile({ ...profile, display_email: e.target.value })} placeholder="jane@brokerage.com" />
            <p className="text-ink-500 text-xs mt-1">
              {isAssistant
                ? "Your contact email — may not be the same as your login email."
                : "Used by YachtPics to contact you — not your login email."}
            </p>
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <input className={inputClass} type="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="(561) 555-0100" />
          </div>
        </div>
      </section>

      {/* Notifications — brokers only */}
      {!isAssistant && (
        <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 mb-5">
          <h2 className="text-h2 text-ink-900 mb-1">Notifications</h2>
          <p className="text-ink-500 text-sm mb-4">Get a heads-up the moment a buyer opens one of your slideshows.</p>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-ink-700">Email me when a buyer opens my slideshow</span>
            <button
              type="button"
              onClick={() => toggleViewAlerts(!profile.notify_on_view)}
              aria-pressed={profile.notify_on_view}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-fast ease-quiet shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 ${profile.notify_on_view ? "bg-accent-500" : "bg-ink-300"}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-fast ease-quiet ${profile.notify_on_view ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
          <p className="text-ink-500 text-xs mt-3">We&rsquo;ll only alert you on a fresh open — at most once every few hours per listing, so it never gets noisy.</p>
        </section>
      )}

      {/* Email preferences — everyone */}
      <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 mb-5">
        <h2 className="text-h2 text-ink-900 mb-1">Email preferences</h2>
        <p className="text-ink-500 text-sm mb-4">Occasional product news, new features, and trial reminders.</p>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-ink-700">Send me product news &amp; updates</span>
          <button
            type="button"
            onClick={() => toggleProductEmails(profile.email_opt_out)}
            aria-pressed={!profile.email_opt_out}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-fast ease-quiet shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 ${!profile.email_opt_out ? "bg-accent-500" : "bg-ink-300"}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-fast ease-quiet ${!profile.email_opt_out ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>
        <p className="text-ink-500 text-xs mt-3">Essential account emails — client delivery confirmations, password resets, and billing — are always sent.</p>
      </section>

      {/* Company Logo — brokers only */}
      {!isAssistant && (
        <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-h2 text-ink-900">Company Logo</h2>
            <HelpTip text="Your logo appears in the footer of every client slideshow, on any device." detail="Best: PNG or SVG with transparent or white background. Max 2 MB." position="below" width={270} />
          </div>
          <p className="text-ink-500 text-sm mb-5">Displayed in the footer of your client slideshows.</p>
          <div className="flex items-center gap-5 flex-wrap">
            {logoUrl ? (
              <div className="w-40 h-20 rounded-ctl border border-hairline bg-ink-50 flex items-center justify-center overflow-hidden p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoUrl} alt="Company logo" className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <div className="w-40 h-20 rounded-ctl border-2 border-dashed border-hairline-strong bg-ink-50 flex items-center justify-center">
                <p className="text-ink-400 text-xs">No logo yet</p>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <label className={"cursor-pointer inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet" + (uploadingLogo ? " opacity-50 pointer-events-none" : "")}>
                {uploadingLogo ? "Uploading..." : logoUrl ? "Replace Logo" : "Upload Logo"}
                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
              </label>
              {logoUrl && <button onClick={removeLogo} className="text-xs text-danger-600 hover:text-danger-700 transition-colors duration-fast ease-quiet text-left">Remove logo</button>}
              <p className="text-ink-500 text-xs">PNG, JPG, SVG or WebP. Max 2MB.</p>
              <p className="text-ink-500 text-xs">Best on a white or transparent background.</p>
            </div>
          </div>
        </section>
      )}

      {/* Brokerage Info — brokers show full form, assistants show bio only */}
      <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 mb-5">
        <h2 className="text-h2 text-ink-900 mb-5">
          {isAssistant ? "About Me" : "Brokerage Information"}
        </h2>
        {isAssistant ? (
          <div>
            <label className={labelClass}>Bio <span className="text-ink-400 font-normal">(optional)</span></label>
            <textarea className={inputClass + " resize-none"} rows={3} value={broker.bio} onChange={(e) => setBroker({ ...broker, bio: e.target.value })} placeholder="A short bio..." />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelClass}>Brokerage Name</label>
              <input className={inputClass} value={broker.brokerage_name} onChange={(e) => setBroker({ ...broker, brokerage_name: e.target.value })} placeholder="" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Street Address</label>
              <input className={inputClass} value={broker.brokerage_address} onChange={(e) => setBroker({ ...broker, brokerage_address: e.target.value })} placeholder="123 Main Street" />
            </div>
            <div>
              <label className={labelClass}>City</label>
              <input className={inputClass} value={broker.brokerage_city} onChange={(e) => setBroker({ ...broker, brokerage_city: e.target.value })} placeholder="" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>State</label>
                <input className={inputClass} value={broker.brokerage_state} onChange={(e) => setBroker({ ...broker, brokerage_state: e.target.value })} placeholder="FL" maxLength={2} />
              </div>
              <div>
                <label className={labelClass}>ZIP</label>
                <input className={inputClass} value={broker.brokerage_zip} onChange={(e) => setBroker({ ...broker, brokerage_zip: e.target.value })} placeholder="00000" />
              </div>
            </div>
            <div>
              <label className={labelClass}>Website</label>
              <input className={inputClass} value={broker.brokerage_website} onChange={(e) => setBroker({ ...broker, brokerage_website: e.target.value })} placeholder="https://yourbrokerage.com" />
            </div>
            <div>
              <label className={labelClass}>License Number</label>
              <input className={inputClass} value={broker.license_number} onChange={(e) => setBroker({ ...broker, license_number: e.target.value })} placeholder="FL-XXXXX" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Bio <span className="text-ink-400 font-normal">(optional)</span></label>
              <textarea className={inputClass + " resize-none"} rows={3} value={broker.bio} onChange={(e) => setBroker({ ...broker, bio: e.target.value })} placeholder="A short bio shown on your client-facing slideshow pages..." />
            </div>
          </div>
        )}
      </section>

      <div className="flex justify-end mb-8">
        <button onClick={saveProfile} disabled={saving} className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 font-semibold px-6 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2">
          {saving ? "Saving..." : "Save Profile"}
        </button>
      </div>

      {/* Assistants — brokers only */}
      {!isAssistant && (
        <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-h2 text-ink-900">Assistants</h2>
            <HelpTip text="Assistants can view listings and download photos on your behalf." detail="They cannot access billing or change your profile. They must first create their own account with the assistant role." position="above" width={280} />
          </div>
          <p className="text-ink-500 text-sm mb-5">Assistants can manage your listings and download photos on your behalf.</p>
          {assistants.length > 0 ? (
            <ul className="divide-y divide-hairline mb-4">
              {assistants.map((a) => (
                <li key={a.assistant_id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink-900">{a.profiles?.first_name ? (a.profiles.first_name + " " + (a.profiles.last_name ?? "")).trim() : "Assistant"}</p>
                    <p className="text-xs text-ink-500">{a.profiles?.display_email ?? ""}</p>
                  </div>
                  <button onClick={() => removeAssistant(a.assistant_id)} className="text-xs text-danger-600 hover:text-danger-700 transition-colors duration-fast ease-quiet">Remove</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-400 mb-4">No assistants linked yet.</p>
          )}
          <div className="flex gap-3">
            <input className={inputClass + " flex-1"} type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="assistant@brokerage.com" />
            <button onClick={inviteAssistant} disabled={inviting || !inviteEmail} className={inkButtonClass + " px-4 py-2.5 whitespace-nowrap"}>
              {inviting ? "Adding..." : "Add Assistant"}
            </button>
          </div>
          <p className="text-ink-500 text-xs mt-2">The assistant must already have an account with the role &quot;assistant&quot; on this platform.</p>
        </section>
      )}

      {/* Change login email */}
      <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 mb-5">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-h2 text-ink-900">Change Login Email</h2>
          <HelpTip text="Changes the email you use to sign in — separate from your contact email above." detail="A confirmation link goes to the new address. Your login will not change until you click it." position="above" width={280} />
        </div>
        <p className="text-ink-500 text-sm mb-5">Changing your login email will send a confirmation to the new address.</p>
        <div className="flex gap-3">
          <input className={inputClass + " flex-1"} type="email" value={newLoginEmail} onChange={(e) => setNewLoginEmail(e.target.value)} placeholder="new@email.com" />
          <button onClick={changeLoginEmail} disabled={changingEmail || !newLoginEmail} className={inkButtonClass + " px-4 py-2.5 whitespace-nowrap"}>
            {changingEmail ? "Sending..." : "Update Email"}
          </button>
        </div>
      </section>

      {/* Change password */}
      <section className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
        <h2 className="text-h2 text-ink-900 mb-1">Change Password</h2>
        <p className="text-ink-500 text-sm mb-5">Choose a new password for your account.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>New Password</label>
            <input
              className={inputClass}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label className={labelClass}>Confirm New Password</label>
            <input
              className={inputClass}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat your password"
            />
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={changePassword}
            disabled={changingPassword || !newPassword || !confirmPassword}
            className={inkButtonClass + " px-5 py-2.5"}
          >
            {changingPassword ? "Updating..." : "Update Password"}
          </button>
        </div>
      </section>
    </div>
  );
}
