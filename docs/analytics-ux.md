# Analytics UX acceptance guide

Apply these checks when changing deep analysis or overview. Use the existing React, native controls and Recharts components; no additional UI dependencies are needed.

- Empty search shows guidance and sends no overview, AI or detail request. An explicit empty Apply opens the whole-market report.
- Resolve each new search independently of the previous subject. Exact province names precede company names containing that province. A company is one subject across supplier, manufacturer and registration data; preserve distinct legal names. Ambiguity requires choosing a suggestion, never a silent stale mode.
- Keep the entity context near the search. Put report tabs beside the heading, with switch, close and new-report controls. Preserve tabs per signed-in account within the browser session.
- Keep period/filter actions in one desktop row, with horizontal scrolling on narrow screens. Expose advanced filters and AI evidence on demand. Show up to two useful findings and one concrete action before expanded AI details.
- Donuts represent parts of an amount total. Show numerical value and share beside them, use consistent colors across periods, and allow both slice and keyboard-accessible legend selection. Unit distributions come from all matched facts, including unknown units, rather than the capped coordinate table.
- The unit comparison measures awarded value, not paid or recognized revenue. Show selected-unit growth only when its comparison amount is positive; show a missing-base state otherwise. Green indicates positive value growth and red negative value growth.
- Keep group and tender cards compact and aligned. Do not render a large blank plot for an empty source. Keep the group selector beside the coordinate heading. Metric titles explain their definitions on hover.
- DAV expiry/new/unknown counts use distinct registrations and compact colored badges. Source record count is a separate metric.
- Scope clear-button CSS to the direct search child; long autocomplete options must keep full-width, wrapping rows in both full desktop and narrow desktop panes.
- The home news feed spans the full desktop width above legal lookup. Filter publisher scope before AI prioritization; exclude unrelated waste, land and construction projects. Editorial prominence is separate from legal severity, so important proposals can feature while retaining the draft label.
- Verify desktop and 390px mobile views, no document overflow, autocomplete transitions, donut selection, tab management, lazy details, context menus and PDF export. Inspect screenshots as well as assertions.

References: [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/), [NN/g dashboard visual perception](https://www.nngroup.com/articles/dashboards-preattentive/), [Carbon dashboard guidance](https://www.carbondesignsystem.com/building-blocks/data-visualization/dashboards), [CDC pie and donut charts](https://www.cdc.gov/cove/data-visualization-types/pie-and-donut-charts.html).
