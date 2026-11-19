"use client";
import { FirebaseError } from "firebase/app";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import {
  onAuthStateChanged,
  getIdTokenResult,
} from "firebase/auth";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import {
  ArrowLeft,
  ImagePlus,
  LoaderCircle,
  PackagePlus,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { getFirebaseAppCheck } from "@/lib/firebase/app-check";
import { accessFromClaims, can } from "@/lib/permissions";
import { getFirebaseServices } from "@/lib/firebase/client";
import {
  formatProductPrice,
  parseProductDocument,
  productFormSchema,
  slugifyProductName,
  type Product,
} from "@/lib/products";

type Access = "checking" | "signed-out" | "not-admin" | "admin";
type CategoryId = "men" | "women" | "accessories";
type ProductDraft = {
  name: string;
  slug: string;
  description: string;
  categoryId: CategoryId;
  price: string;
  currency: string;
  stock: string;
  status: "draft" | "published";
  isFeatured: boolean;
  isNewArrival: boolean;
  imageUrl: string;
  imagePath?: string;
};

const categoryOptions: Array<{ id: CategoryId; name: string }> = [
  { id: "men", name: "Men's Collection" },
  { id: "women", name: "Women's Collection" },
  { id: "accessories", name: "Accessories" },
];

const emptyDraft: ProductDraft = {
  name: "",
  slug: "",
  description: "",
  categoryId: "women",
  price: "",
  currency: "USD",
  stock: "0",
  status: "draft",
  isFeatured: false,
  isNewArrival: true,
  imageUrl: "",
};

function errorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    if (error.code === "permission-denied") {
      return "Firestore denied this action. Confirm that admin Firestore rules are published and this account has the admin claim.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "The product action could not be completed.";
}

function validateImage(file: File): void {
  const supportedTypes = ["image/jpeg", "image/png", "image/webp", "image/avif"];
  if (!supportedTypes.includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, WebP, or AVIF image.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Product images must be 5 MB or smaller.");
  }
}

export default function AdminProductsPage() {
  const [access, setAccess] = useState<Access>("checking");
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [slugWasEdited, setSlugWasEdited] = useState(false);

  const publishedCount = useMemo(
    () => products.filter((product) => product.status === "published").length,
    [products],
  );

  useEffect(() => {
    let active = true;
    const { auth } = getFirebaseServices();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (active) {
          setAccess("signed-out");
        }
        return;
      }

      try {
        const token = await getIdTokenResult(user, true);
        if (active) {
          setAccess(can(accessFromClaims(token.claims), "catalog") ? "admin" : "not-admin");
        }
      } catch (error) {
        if (active) {
          setPageError(errorMessage(error));
          setAccess("not-admin");
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (access !== "admin") {
      return;
    }

    let active = true;
    try {
      getFirebaseAppCheck();
      const { db } = getFirebaseServices();
      const productsQuery = query(
        collection(db, "products"),
        orderBy("updatedAt", "desc"),
        limit(200),
      );

      const unsubscribe = onSnapshot(
        productsQuery,
        (snapshot) => {
          try {
            const records = snapshot.docs.map((product) =>
              parseProductDocument(product.id, product.data()),
            );
            if (active) {
              setProducts(records);
              setIsLoading(false);
            }
          } catch (error) {
            if (active) {
              setPageError(errorMessage(error));
              setIsLoading(false);
            }
          }
        },
        (error) => {
          if (active) {
            setPageError(errorMessage(error));
            setIsLoading(false);
          }
        },
      );

      return () => {
        active = false;
        unsubscribe();
      };
    } catch (error) {
      const message = errorMessage(error);
      queueMicrotask(() => {
        if (active) {
          setPageError(message);
          setIsLoading(false);
        }
      });
      return () => {
        active = false;
      };
    }
  }, [access]);

  const resetForm = () => {
    setDraft(emptyDraft);
    setSelectedImage(null);
    setEditingId(null);
    setSlugWasEdited(false);
  };

  const beginEdit = (product: Product) => {
    setEditingId(product.id);
    setSlugWasEdited(true);
    setSelectedImage(null);
    setDraft({
      name: product.name,
      slug: product.slug,
      description: product.description,
      categoryId: product.categoryId,
      price: (product.priceMinor / 100).toFixed(2),
      currency: product.currency,
      stock: String(product.stock),
      status: product.status,
      isFeatured: product.isFeatured,
      isNewArrival: product.isNewArrival,
      imageUrl: product.imageUrl,
      imagePath: product.imagePath,
    });
    setPageError(null);
    setNotice(null);
    document.getElementById("product-form")?.scrollIntoView({ behavior: "smooth" });
  };

  const handleNameChange = (name: string) => {
    setDraft((current) => ({
      ...current,
      name,
      slug: slugWasEdited ? current.slug : slugifyProductName(name),
    }));
  };

  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPageError(null);
    setNotice(null);

    if (!draft.imageUrl && !selectedImage) {
      setPageError("Add a product image URL or upload an image before saving.");
      return;
    }

    if (selectedImage) {
      try {
        validateImage(selectedImage);
      } catch (error) {
        setPageError(errorMessage(error));
        return;
      }
    }

    const slug = slugifyProductName(draft.slug || draft.name);
    const categoryName =
      categoryOptions.find((category) => category.id === draft.categoryId)?.name ?? "";
    const parsed = productFormSchema.safeParse({
      name: draft.name,
      slug,
      description: draft.description,
      categoryId: draft.categoryId,
      categoryName,
      priceMinor: Math.round(Number(draft.price) * 100),
      currency: draft.currency,
      stock: Number(draft.stock),
      status: draft.status,
      isFeatured: draft.isFeatured,
      isNewArrival: draft.isNewArrival,
      imageUrl: draft.imageUrl,
      imagePath: draft.imagePath,
    });

    if (!parsed.success) {
      setPageError(parsed.error.issues[0]?.message ?? "Check the product details and try again.");
      return;
    }

    setIsSaving(true);
    let uploadedImagePath: string | null = null;
    try {
      const { db, storage } = getFirebaseServices();
      const duplicateSnapshot = await getDocs(
        query(collection(db, "products"), where("slug", "==", parsed.data.slug), limit(2)),
      );
      const duplicate = duplicateSnapshot.docs.find((product) => product.id !== editingId);
      if (duplicate) {
        throw new Error("That product URL is already in use. Choose a different product name.");
      }

      const productRef = editingId
        ? doc(db, "products", editingId)
        : doc(collection(db, "products"));
      let imageUrl = parsed.data.imageUrl;
      let imagePath = parsed.data.imagePath;
      const { imagePath: validatedImagePath, ...validatedProduct } = parsed.data;
      imagePath = validatedImagePath;

      if (selectedImage) {
        const extension = selectedImage.type.split("/")[1].replace("jpeg", "jpg");
        imagePath = `products/${productRef.id}/${Date.now()}.${extension}`;
        const imageRef = ref(storage, imagePath);
        await uploadBytes(imageRef, selectedImage, {
          contentType: selectedImage.type,
          cacheControl: "public,max-age=31536000",
        });
        uploadedImagePath = imagePath;
        imageUrl = await getDownloadURL(imageRef);
      }

      await setDoc(
        productRef,
        {
          ...validatedProduct,
          imageUrl,
          ...(imagePath ? { imagePath } : {}),
          updatedAt: serverTimestamp(),
          ...(editingId ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: Boolean(editingId) },
      );

      const previousImagePath = draft.imagePath;
      resetForm();
      setNotice(editingId ? "Product updated." : "Product created.");

      if (previousImagePath && previousImagePath !== imagePath) {
        try {
          await deleteObject(ref(storage, previousImagePath));
        } catch (error) {
          setNotice(`Product saved, but old image cleanup failed: ${errorMessage(error)}`);
        }
      }
    } catch (error) {
      if (uploadedImagePath) {
        try {
          await deleteObject(ref(getFirebaseServices().storage, uploadedImagePath));
        } catch (cleanupError) {
          setPageError(
            `${errorMessage(error)} Image cleanup also failed: ${errorMessage(cleanupError)}`,
          );
          setIsSaving(false);
          return;
        }
      }
      setPageError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const removeProduct = async (product: Product) => {
    if (!window.confirm(`Delete “${product.name}”? This cannot be undone.`)) {
      return;
    }

    setPageError(null);
    setNotice(null);
    try {
      const { db, storage } = getFirebaseServices();
      await deleteDoc(doc(db, "products", product.id));
      if (product.imagePath) {
        try {
          await deleteObject(ref(storage, product.imagePath));
        } catch (error) {
          setPageError(`Product deleted, but its stored image could not be removed: ${errorMessage(error)}`);
          return;
        }
      }
      if (editingId === product.id) {
        resetForm();
      }
      setNotice("Product deleted.");
    } catch (error) {
      setPageError(errorMessage(error));
    }
  };

  const togglePublished = async (product: Product) => {
    setPageError(null);
    setNotice(null);
    try {
      const { db } = getFirebaseServices();
      await setDoc(
        doc(db, "products", product.id),
        {
          status: product.status === "published" ? "draft" : "published",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setNotice(product.status === "published" ? "Product moved to drafts." : "Product published.");
    } catch (error) {
      setPageError(errorMessage(error));
    }
  };

  if (access === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f3efe8]">
        <p className="text-sm text-[#615b56]">Checking administrator access…</p>
      </main>
    );
  }

  if (access !== "admin") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f3efe8] px-4">
        <section className="max-w-md rounded-3xl border border-[#e5dacd] bg-[#fbf8f5] p-8">
          <h1 className="font-display text-3xl">Administrator access required</h1>
          <p className="mt-3 text-sm leading-6 text-[#615b56]">
            {access === "signed-out"
              ? "Sign in to your administrator account to manage products."
              : "This account does not have the Super Admin claim."}
          </p>
          {pageError ? <p className="mt-3 text-sm text-[#a33f2f]" role="alert">{pageError}</p> : null}
          <Link href="/admin" className="mt-5 inline-flex rounded-full bg-[#17243b] px-5 py-3 text-sm text-white">
            Go to admin sign in
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f3efe8] px-4 py-8 text-[#202020] sm:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-5 border-b border-[#e5dacd] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/admin" className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[#615b56] hover:text-[#17243b]">
              <ArrowLeft size={15} />
              Store overview
            </Link>
            <p className="mt-5 text-xs uppercase tracking-[0.18em] text-[#9a8060]">ÉLANO · Catalog</p>
            <h1 className="mt-2 font-display text-5xl tracking-[-0.05em]">Products</h1>
            <p className="mt-2 text-sm text-[#615b56]">
              {products.length} products · {publishedCount} published
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetForm();
              document.getElementById("product-form")?.scrollIntoView({ behavior: "smooth" });
            }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#17243b] px-5 text-sm font-medium text-white transition hover:bg-[#263752]"
          >
            <Plus size={16} />
            Add product
          </button>
        </header>

        {pageError ? (
          <p className="mt-5 rounded-xl border border-[#eed2cb] bg-[#fff5f2] px-4 py-3 text-sm text-[#a33f2f]" role="alert">
            {pageError}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-5 rounded-xl border border-[#cfe0d3] bg-[#f2f8f3] px-4 py-3 text-sm text-[#315c41]" role="status">
            {notice}
          </p>
        ) : null}

        <section id="product-form" className="mt-7 scroll-mt-6 rounded-3xl border border-[#e5dacd] bg-[#fbf8f5] p-5 sm:p-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#17243b] text-white">
                {editingId ? <Pencil size={17} /> : <PackagePlus size={18} />}
              </span>
              <div>
                <h2 className="font-display text-3xl">{editingId ? "Edit product" : "Add a product"}</h2>
                <p className="mt-1 text-sm text-[#746d68]">Saved changes appear on the storefront when published.</p>
              </div>
            </div>
            {editingId ? (
              <button type="button" onClick={resetForm} aria-label="Cancel editing" className="rounded-full p-2 text-[#746d68] hover:bg-[#f1ece5]">
                <X size={18} />
              </button>
            ) : null}
          </div>

          <form onSubmit={saveProduct} className="grid gap-5 md:grid-cols-2">
            <label className="text-sm font-medium">
              Product name
              <input
                required
                maxLength={120}
                value={draft.name}
                onChange={(event) => handleNameChange(event.target.value)}
                placeholder="Premium linen shirt"
                className="mt-2 h-12 w-full rounded-xl border border-[#d8c9b9] bg-white px-4 outline-none focus:border-[#17243b]"
              />
            </label>
            <label className="text-sm font-medium">
              Product URL slug
              <input
                required
                maxLength={140}
                value={draft.slug}
                onChange={(event) => {
                  setSlugWasEdited(true);
                  setDraft((current) => ({ ...current, slug: slugifyProductName(event.target.value) }));
                }}
                placeholder="premium-linen-shirt"
                className="mt-2 h-12 w-full rounded-xl border border-[#d8c9b9] bg-white px-4 outline-none focus:border-[#17243b]"
              />
            </label>
            <label className="text-sm font-medium">
              Category
              <select
                value={draft.categoryId}
                onChange={(event) => setDraft((current) => ({ ...current, categoryId: event.target.value as CategoryId }))}
                className="mt-2 h-12 w-full rounded-xl border border-[#d8c9b9] bg-white px-4 outline-none focus:border-[#17243b]"
              >
                {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-[1fr_110px] gap-3">
              <label className="text-sm font-medium">
                Price
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={draft.price}
                  onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))}
                  placeholder="79.00"
                  className="mt-2 h-12 w-full rounded-xl border border-[#d8c9b9] bg-white px-4 outline-none focus:border-[#17243b]"
                />
              </label>
              <label className="text-sm font-medium">
                Currency
                <input
                  required
                  minLength={3}
                  maxLength={3}
                  value={draft.currency}
                  onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
                  placeholder="USD"
                  className="mt-2 h-12 w-full rounded-xl border border-[#d8c9b9] bg-white px-3 uppercase outline-none focus:border-[#17243b]"
                />
              </label>
            </div>
            <label className="text-sm font-medium">
              Stock quantity
              <input
                type="number"
                min="0"
                step="1"
                required
                value={draft.stock}
                onChange={(event) => setDraft((current) => ({ ...current, stock: event.target.value }))}
                className="mt-2 h-12 w-full rounded-xl border border-[#d8c9b9] bg-white px-4 outline-none focus:border-[#17243b]"
              />
            </label>
            <label className="text-sm font-medium md:col-span-2">
              Description
              <textarea
                rows={3}
                maxLength={2000}
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="Describe the fabric, fit, and details."
                className="mt-2 w-full resize-y rounded-xl border border-[#d8c9b9] bg-white px-4 py-3 outline-none focus:border-[#17243b]"
              />
            </label>
            <label className="text-sm font-medium">
              Image URL
              <input
                type="url"
                value={draft.imageUrl}
                onChange={(event) => setDraft((current) => ({ ...current, imageUrl: event.target.value }))}
                placeholder="https://..."
                className="mt-2 h-12 w-full rounded-xl border border-[#d8c9b9] bg-white px-4 outline-none focus:border-[#17243b]"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[#cdbdaa] bg-white px-4 py-3 text-sm text-[#514a43] transition hover:border-[#17243b]">
              <ImagePlus size={19} className="shrink-0 text-[#9a8060]" />
              <span className="min-w-0">
                <span className="block font-medium">{selectedImage?.name ?? "Upload product image"}</span>
                <span className="mt-1 block text-xs text-[#8b837b]">JPEG, PNG, WebP, AVIF · Up to 5 MB</span>
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="sr-only"
                onChange={(event) => setSelectedImage(event.target.files?.[0] ?? null)}
              />
            </label>
            {draft.imageUrl || draft.imagePath ? (
              <div className="flex items-center gap-3 md:col-span-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={draft.imageUrl}
                  alt=""
                  className="h-16 w-16 rounded-lg border border-[#e5dacd] object-cover"
                />
                <span className="text-xs text-[#746d68]">Current product image</span>
              </div>
            ) : null}

            <label className="flex items-center gap-3 text-sm text-[#4f4944]">
              <input
                type="checkbox"
                checked={draft.isFeatured}
                onChange={(event) => setDraft((current) => ({ ...current, isFeatured: event.target.checked }))}
                className="h-4 w-4 accent-[#17243b]"
              />
              Featured product
            </label>
            <label className="flex items-center gap-3 text-sm text-[#4f4944]">
              <input
                type="checkbox"
                checked={draft.isNewArrival}
                onChange={(event) => setDraft((current) => ({ ...current, isNewArrival: event.target.checked }))}
                className="h-4 w-4 accent-[#17243b]"
              />
              New arrival
            </label>
            <label className="text-sm font-medium">
              Publishing status
              <select
                value={draft.status}
                onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as ProductDraft["status"] }))}
                className="mt-2 h-12 w-full rounded-xl border border-[#d8c9b9] bg-white px-4 outline-none focus:border-[#17243b]"
              >
                <option value="draft">Draft — hidden from storefront</option>
                <option value="published">Published — visible on storefront</option>
              </select>
            </label>
            <div className="flex items-end gap-3 md:col-span-2">
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#17243b] px-6 text-sm font-medium text-white transition hover:bg-[#263752] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={16} />}
                {isSaving ? "Saving…" : editingId ? "Save changes" : "Create product"}
              </button>
              {editingId ? (
                <button type="button" onClick={resetForm} className="h-12 rounded-full border border-[#d8c9b9] px-5 text-sm">
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="font-display text-3xl">Catalog</h2>
            <span className="text-xs uppercase tracking-[0.14em] text-[#81776f]">Live from Firestore</span>
          </div>
          {isLoading ? (
            <p className="rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-6 text-sm text-[#615b56]" role="status">Loading products…</p>
          ) : products.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#d8c9b9] bg-[#fbf8f5] px-6 py-10 text-center">
              <PackagePlus size={28} className="mx-auto text-[#9a8060]" />
              <h3 className="mt-3 font-display text-2xl">Your catalog is ready</h3>
              <p className="mt-2 text-sm text-[#746d68]">Add a product above; publish it to make it appear on the storefront.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {products.map((product) => (
                <article key={product.id} className="overflow-hidden rounded-2xl border border-[#e5dacd] bg-[#fbf8f5]">
                  {product.imageUrl ? (
                    // This image is user-managed through the restricted admin product form.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.imageUrl} alt={product.name} className="h-56 w-full object-cover" />
                  ) : (
                    <div className="flex h-56 items-center justify-center bg-[#eee8df] text-sm text-[#81776f]">No image</div>
                  )}
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-display text-2xl leading-tight">{product.name}</h3>
                        <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[#81776f]">{product.categoryName}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] ${product.status === "published" ? "bg-[#e6efe7] text-[#315c41]" : "bg-[#eee8df] text-[#766b60]"}`}>
                        {product.status}
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm">
                      <span className="font-semibold">{formatProductPrice(product.priceMinor, product.currency)}</span>
                      <span className="text-[#746d68]">{product.stock} in stock</span>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2 border-t border-[#e9dfd3] pt-4">
                      <button type="button" onClick={() => beginEdit(product)} className="inline-flex h-9 items-center gap-2 rounded-full border border-[#d8c9b9] px-4 text-xs font-medium hover:bg-[#f3efe8]">
                        <Pencil size={14} />
                        Edit
                      </button>
                      <button type="button" onClick={() => void togglePublished(product)} className="h-9 rounded-full border border-[#d8c9b9] px-4 text-xs font-medium hover:bg-[#f3efe8]">
                        {product.status === "published" ? "Unpublish" : "Publish"}
                      </button>
                      <button type="button" onClick={() => void removeProduct(product)} className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-medium text-[#a33f2f] hover:bg-[#fff0eb]">
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
