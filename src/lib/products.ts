import * as z from "zod";

export const productFormSchema = z.object({
  name: z.string().trim().min(2, "Product name must be at least 2 characters.").max(120),
  slug: z.string().trim().min(2, "Product URL is required.").max(140),
  description: z.string().trim().max(2000).default(""),
  categoryId: z.enum(["men", "women", "accessories"]),
  categoryName: z.string().trim().min(1),
  priceMinor: z.number().int().nonnegative("Price cannot be negative."),
  currency: z.string().trim().length(3, "Use a 3-letter currency code.").transform((value) => value.toUpperCase()),
  stock: z.number().int().nonnegative("Stock cannot be negative."),
  status: z.enum(["draft", "published"]),
  isFeatured: z.boolean(),
  isNewArrival: z.boolean(),
  imageUrl: z.string().trim().url("Enter a valid image URL.").or(z.literal("")),
  imagePath: z.string().optional(),
});

export type ProductFormValues = z.input<typeof productFormSchema>;

export interface Product extends Omit<z.output<typeof productFormSchema>, "imagePath"> {
  id: string;
  imagePath?: string;
  createdAt?: unknown;
}

const productDocumentSchema = productFormSchema.extend({
  imagePath: z.string().optional(),
});

export function parseProductDocument(id: string, value: unknown): Product {
  const parsed = productDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Product "${id}" has invalid data: ${parsed.error.issues[0]?.message ?? "unknown validation error"}`);
  }

  const record = value as Record<string, unknown>;
  return {
    ...parsed.data,
    id,
    createdAt: record.createdAt,
  };
}

export function formatProductPrice(priceMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(priceMinor / 100);
  } catch {
    return `${currency} ${(priceMinor / 100).toFixed(2)}`;
  }
}

export function slugifyProductName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
