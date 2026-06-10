/** Met à la corbeille Gmail les échanges avec un expéditeur (reset test prospect). */
export async function trashGmailMessagesFromSender(
  gmail: any,
  senderEmail: string,
  options?: { mailbox?: string; newerThanDays?: number },
): Promise<{ trashed: number; messageIds: string[] }> {
  const mailbox = String(
    options?.mailbox || process.env.GMAIL_USER || "assurance@leclubimmobilier.fr",
  ).toLowerCase();
  const days = Math.max(1, Number(options?.newerThanDays || 30) || 30);
  const sender = String(senderEmail || "").trim().toLowerCase();
  if (!sender) return { trashed: 0, messageIds: [] };

  const q = `from:${sender} (to:${mailbox} OR deliveredto:${mailbox}) newer_than:${days}d -in:spam`;
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  while (messageIds.length < 200) {
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: 50,
      pageToken,
    });
    for (const m of listRes.data.messages || []) {
      if (m.id) messageIds.push(m.id);
    }
    pageToken = listRes.data.nextPageToken || undefined;
    if (!pageToken) break;
  }

  const trashed: string[] = [];
  for (const id of messageIds) {
    try {
      await gmail.users.messages.trash({ userId: "me", id });
      trashed.push(id);
    } catch (err: any) {
      console.warn(`[Gmail trash] ${id}: ${err?.message || err}`);
    }
  }

  if (trashed.length > 0) {
    console.log(`[Gmail trash] ${trashed.length} mail(s) de ${sender} → corbeille`);
  }
  return { trashed: trashed.length, messageIds: trashed };
}
