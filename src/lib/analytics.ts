export interface AnalyticsItem {
  item_id: string;
  item_name: string;
  item_category?: string;
  price?: number;
  quantity?: number;
}

type StoreEventName = "page_view" | "view_item" | "view_item_list" | "add_to_cart" | "search";

declare global {
  interface Window {
    gtag?: (
      command: "event",
      eventName: StoreEventName,
      parameters: Record<string, unknown>,
    ) => void;
  }
}

export function trackStoreEvent(
  eventName: StoreEventName,
  parameters: Record<string, unknown>,
): void {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", eventName, parameters);
}
