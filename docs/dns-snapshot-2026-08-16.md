# yachtpics.com DNS — snapshot before moving to Cloudflare

Taken 16 August 2026, straight from public DNS (Google's resolver), while the
domain was still on GoDaddy nameservers.

Reason for capturing it: moving a domain to Cloudflare relies on Cloudflare's
scanner finding every existing record. It usually does. If it misses one, the
symptom can be email silently not arriving — which is the kind of thing you
notice days later. This is the list to check the new setup against, record by
record.

## Nameservers before the move

```
ns77.domaincontrol.com
ns78.domaincontrol.com
```
(GoDaddy)

## Records that must exist after the move

| Type  | Name           | Value                                        | Purpose |
|-------|----------------|----------------------------------------------|---------|
| A     | `@`            | `173.201.181.158`                            | The website itself, hosted at GoDaddy |
| CNAME | `www`          | `yachtpics.com`                              | www → apex |
| A     | `mail`         | `173.201.181.158`                            | Legacy mail hostname |
| MX    | `@`            | `yachtpics-com.mail.protection.outlook.com` (priority 0) | **Email — Microsoft 365. Business critical.** |
| TXT   | `@`            | `NETORGFT2585483.onmicrosoft.com`            | Microsoft 365 domain verification |
| TXT   | `@`            | `v=spf1 include:secureserver.net -all`       | SPF — stops mail being marked as spoofed |
| TXT   | `@`            | `google-site-verification=v10psmYRB9Owq3LC94IZ22zXNgDutMdAFyoF3i4GLXc` | Google Search Console ownership |
| CNAME | `autodiscover` | `autodiscover.outlook.com`                   | Outlook client auto-configuration |
| CNAME | `portal`       | `5cf9b65b0ab62168.vercel-dns-017.com`        | portal.yachtpics.com → Vercel |

No AAAA records existed. No DKIM selectors responded to the usual probes
(`zoho`, `zmail`, `google`, `default`) — worth re-checking in the Microsoft 365
admin centre if mail ever starts failing DKIM.

## Intent of the move

Cloudflare R2 will only serve a public custom domain (`media.yachtpics.com`) if
the domain is a zone on the Cloudflare account. A partial/CNAME setup would have
avoided moving DNS, but that is Business-plan only.

Every record above should be set to **DNS only** (grey cloud) — Cloudflare
answers DNS and nothing else, so the website stays served by GoDaddy and mail
stays with Microsoft. Behaviour is unchanged. The single new record is
`media.yachtpics.com`, created by R2 itself.

## How to verify afterwards

```
dig +short NS yachtpics.com          # expect the two Cloudflare nameservers
dig +short A yachtpics.com           # expect 173.201.181.158
dig +short MX yachtpics.com          # expect ...outlook.com, priority 0
dig +short TXT yachtpics.com         # expect all three TXT values above
dig +short CNAME autodiscover.yachtpics.com
dig +short CNAME portal.yachtpics.com
```

Then send a test email to the yachtpics.com address from an outside account and
confirm it arrives.
