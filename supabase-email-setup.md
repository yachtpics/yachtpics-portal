# Supabase Custom SMTP + Email Template Setup

## Step 1 — Get your Resend API key

1. Go to [vercel.com](https://vercel.com) → your project → **Settings** → **Environment Variables**
2. Find `RESEND_API_KEY` and copy the value (starts with `re_`)

---

## Step 2 — Configure SMTP in Supabase

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **yachtpics-portal** project
2. **Authentication** → **Settings** → scroll to **SMTP Settings**
3. Toggle **Enable Custom SMTP** ON
4. Fill in:

| Field | Value |
|-------|-------|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | *(your RESEND_API_KEY from Step 1)* |
| Sender name | `YachtPics` |
| Sender email | `hello@yachtpics.com` |

5. Click **Save**

---

## Step 3 — Update Email Templates

Go to **Authentication** → **Email Templates** and paste each template below.

---

### Reset Password

**Subject:** `Reset your YachtPics Portal password`

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Reset your password</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">
        We received a request to reset the password for your YachtPics Portal account. Click the button below to choose a new one.
      </p>
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:28px;">Reset Password &rarr;</a>
      <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;line-height:1.6;">This link expires in 24 hours. If you didn't request a password reset, you can safely ignore this email — your account remains secure.</p>
    </div>
    <div style="padding:24px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#c4c9d4;">Powered by <a href="https://yachtpics.com" style="color:#c4c9d4;text-decoration:none;">YachtPics</a> &middot; <a href="mailto:hello@yachtpics.com" style="color:#c4c9d4;text-decoration:none;">hello@yachtpics.com</a></p>
    </div>
  </div>
</body>
</html>
```

---

### Confirm Signup

**Subject:** `Confirm your YachtPics Portal email`

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Confirm your email</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">
        Click below to confirm your email address and activate your YachtPics Portal account.
      </p>
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:28px;">Confirm Email &rarr;</a>
      <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">If you didn't create a YachtPics Portal account, you can safely ignore this email.</p>
    </div>
    <div style="padding:24px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#c4c9d4;">Powered by <a href="https://yachtpics.com" style="color:#c4c9d4;text-decoration:none;">YachtPics</a> &middot; <a href="mailto:hello@yachtpics.com" style="color:#c4c9d4;text-decoration:none;">hello@yachtpics.com</a></p>
    </div>
  </div>
</body>
</html>
```

---

### Change Email Address

**Subject:** `Confirm your new YachtPics Portal email`

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Confirm your new email</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">
        You requested a change to your YachtPics Portal login email. Click below to confirm the new address and complete the update.
      </p>
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:28px;">Confirm New Email &rarr;</a>
      <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">If you didn't request this change, please contact us immediately at <a href="mailto:hello@yachtpics.com" style="color:#9ca3af;">hello@yachtpics.com</a>.</p>
    </div>
    <div style="padding:24px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#c4c9d4;">Powered by <a href="https://yachtpics.com" style="color:#c4c9d4;text-decoration:none;">YachtPics</a> &middot; <a href="mailto:hello@yachtpics.com" style="color:#c4c9d4;text-decoration:none;">hello@yachtpics.com</a></p>
    </div>
  </div>
</body>
</html>
```

---

### Magic Link (if used)

**Subject:** `Your YachtPics Portal sign-in link`

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Your sign-in link</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">
        Click below to sign in to your YachtPics Portal account. This link expires in 1 hour and can only be used once.
      </p>
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:28px;">Sign In &rarr;</a>
      <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">If you didn't request this, you can safely ignore this email.</p>
    </div>
    <div style="padding:24px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#c4c9d4;">Powered by <a href="https://yachtpics.com" style="color:#c4c9d4;text-decoration:none;">YachtPics</a> &middot; <a href="mailto:hello@yachtpics.com" style="color:#c4c9d4;text-decoration:none;">hello@yachtpics.com</a></p>
    </div>
  </div>
</body>
</html>
```

---

## Done

Once SMTP is saved and templates are pasted, send a test password reset to yourself to confirm it arrives from `hello@yachtpics.com` with the correct design.
