import scraper from "@/scraper/scraper";

export async function GET() {
  const job = await scraper.getStatus();

  if (!job || !job.data || job.data.length === 0) {
    return new Response("No CSV data available yet.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const filename = `upwork-leads-${timestamp}.csv`;

  const headers = [
    "Name",
    "Title",
    "Profile URL",
    "Agency Name",
    "Agency URL",
    "Website",
    "LinkedIn",
    "Instagram",
    "Facebook",
    "Twitter",
    "YouTube",
    "GitHub",
    "Dribbble",
    "Behance",
  ];

  const escapeCsv = (val) => {
    if (!val) return '""';
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return '"' + str + '"';
  };

  const rows = job.data.map((lead) => {
    const socials = lead.socials || {};
    return [
      lead.name,
      lead.title,
      lead.profileUrl,
      lead.agencyName,
      lead.agencyUrl,
      lead.website,
      socials.linkedin || lead.linkedin,
      socials.instagram,
      socials.facebook,
      socials.twitter,
      socials.youtube,
      socials.github,
      socials.dribbble,
      socials.behance,
    ]
      .map(escapeCsv)
      .join(",");
  });

  const csv = `\uFEFF${headers.join(",")}\n${rows.join("\n")}\n`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
