export type GarageTab = "garage" | "fuel" | "maintenance" | "reports" | "settings";

export function activeGarageTab(path: string): GarageTab {
  if (path === "/fuel" || /^\/cars\/\d+\/fuel(?:\/|$)/.test(path)) return "fuel";
  if (path === "/maintenance" || /^\/cars\/\d+\/maintenance(?:\/|$)/.test(path)) return "maintenance";
  if (path === "/reports" || path.startsWith("/reports/") || /^\/cars\/\d+\/costs(?:\/|$)/.test(path)) return "reports";
  if (path === "/settings" || path === "/imports" || path.startsWith("/imports/")) return "settings";
  return "garage";
}
