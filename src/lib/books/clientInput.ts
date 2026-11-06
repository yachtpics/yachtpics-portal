import { cleanText, isEmail } from "./staff";

/** Validated client fields from a create/edit body. Only keys present in the body are returned. */
export function clientFields(body: Record<string, unknown>, creating: boolean): { fields: Record<string, unknown>; error?: string } {
  const fields: Record<string, unknown> = {};
  const text = ["company_name", "first_name", "last_name", "phone", "mobile"];
  text.forEach((k) => { if (k in body) fields[k] = cleanText(body[k], 200); });
  if ("notes" in body) fields.notes = cleanText(body.notes, 4000);
  if ("email" in body) {
    const e = cleanText(body.email, 254);
    const email = e ? e.toLowerCase() : null;
    if (!isEmail(email)) return { fields, error: "That email doesn't look right." };
    fields.email = email;
  }
  if ("status" in body) {
    if (body.status !== "active" && body.status !== "inactive") return { fields, error: "Status must be active or inactive." };
    fields.status = body.status;
  }
  if ("display_name" in body || creating) {
    let name = cleanText(body.display_name, 200);
    if (!name) {
      const person = [cleanText(body.first_name, 100), cleanText(body.last_name, 100)].filter(Boolean).join(" ");
      name = person || cleanText(body.company_name, 200);
    }
    if (!name) return { fields, error: "Give the client a name." };
    fields.display_name = name;
  }
  return { fields };
}
