// Paste into Workers Playground for a read-only, credential-free network test.
export default {
  async fetch() {
    const targets = [
      ["vss", "https://quanlythuocv1.vss.gov.vn/kqdt/export?ngaycongbo=02%2F10%2F2026&loai=1", {}],
      ["msc", "https://muasamcong.mpi.gov.vn/api/unau/portal/ebidorg/bid-no-contractor/get-detail", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: { id: "74f2085c-b318-4aae-9b8e-007e57109bba" } }),
      }],
    ];
    const results = await Promise.all(targets.map(async ([source, url, options]) => {
      try {
        const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
        const text = await response.text();
        return { source, status: response.status, bytes: text.length,
          spreadsheetRows: source === "vss" && text.includes("Workbook")
            ? (text.match(/<Row[ >]/g) || []).length : undefined,
          lots: source === "msc" && response.ok
            ? JSON.parse(text).body?.bidNotification?.lotDTOList?.length : undefined };
      } catch (error) {
        return { source, error: String(error).slice(0,200) };
      }
    }));
    return Response.json(results);
  },
};
