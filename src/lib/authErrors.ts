/**
 * Turn a Supabase Auth error into a calm, plain-English line for the
 * sign-in / sign-up screens. Raw Supabase text ("Invalid login credentials",
 * "For security purposes, you can only request this after 37 seconds") is
 * logged to the console for us, never shown to the broker.
 */
type AuthErrorLike = { message?: string; code?: string; status?: number } | null | undefined;

export function friendlyAuthError(err: AuthErrorLike, context: "login" | "signup" | "reset" | "link" = "login"): string {
  if (!err) return "";
  if (err.message) console.warn("Auth error:", err.code ?? "", err.message);
  const code = (err.code ?? "").toLowerCase();
  const msg = (err.message ?? "").toLowerCase();

  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) {
    return "That email and password don't match our records. Check them and try again, or use a sign-in link instead.";
  }
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) {
    return "Please confirm your email first. Open the confirmation email we sent, then sign in.";
  }
  if (
    err.status === 429 ||
    code.startsWith("over_") ||
    msg.includes("rate limit") ||
    msg.includes("for security purposes") ||
    msg.includes("too many")
  ) {
    return "Too many attempts in a short time. Please wait a minute and try again.";
  }
  if (code === "user_already_exists" || msg.includes("already registered")) {
    return "There's already an account for this email. Sign in instead, or reset your password.";
  }
  if (code === "weak_password" || msg.includes("password should be")) {
    return "Please choose a longer password — at least 8 characters.";
  }
  if (code === "same_password" || msg.includes("different from the old password")) {
    return "Your new password must be different from your current one.";
  }
  if (code === "email_address_invalid" || msg.includes("invalid email") || msg.includes("unable to validate email")) {
    return "That email address doesn't look right. Please check it and try again.";
  }
  if (msg.includes("failed to fetch") || msg.includes("network")) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  if (context === "signup") return "We couldn't create your account just now. Please try again in a moment.";
  if (context === "link") return "We couldn't send the link just now. Please try again in a moment.";
  if (context === "reset") return "We couldn't update your password just now. Please try again in a moment.";
  return "We couldn't sign you in just now. Please try again in a moment.";
}
