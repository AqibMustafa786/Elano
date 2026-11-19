"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FirebaseError } from "firebase/app";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import {
  ArrowRight,
  ChevronRight,
  Headphones,
  Heart,
  Menu,
  Minus,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Star,
  Trash2,
  Truck,
  User,
  X,
} from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";

import { getFirebaseAppCheck } from "@/lib/firebase/app-check";
import { getFirebaseServices } from "@/lib/firebase/client";
import { trackStoreEvent } from "@/lib/analytics";
import { subscribeToNewsletter } from "@/lib/firebase/functions";
import { formatProductPrice, parseProductDocument, type Product } from "@/lib/products";
import { useCartStore } from "@/store/cart";
import { useWishlistStore } from "@/store/store";

const navItems = [
  { label: "New In", href: "#products" },
  { label: "Men", href: "#products", category: "men" },
  { label: "Women", href: "#products", category: "women" },
  { label: "Accessories", href: "#products", category: "accessories" },
  { label: "Collections", href: "#categories" },
  { label: "Lookbook", href: "#inspiration" },
];

const features = [
  { icon: Truck, title: "Free shipping", copy: "On orders over $150" },
  { icon: RefreshCcw, title: "Easy returns", copy: "30-day return policy" },
  { icon: ShieldCheck, title: "Secure payment", copy: "100% secure checkout" },
  { icon: Headphones, title: "24/7 support", copy: "Dedicated assistance" },
];

const categories = [
  { id: "men", name: "Men's Collection", subtitle: "Classic. Refined. Timeless.", image: "https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=900&q=80" },
  { id: "women", name: "Women's Collection", subtitle: "Elegant. Modern. You.", image: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80" },
  { id: "accessories", name: "Accessories", subtitle: "Small details. Big impact.", image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80" },
];

const inspiration = [
  { title: "City layers", copy: "Refined silhouettes for everyday motion.", image: "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=1000&q=80" },
  { title: "Weekend notes", copy: "Warm neutrals and soft structure.", image: "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1000&q=80" },
  { title: "After dark", copy: "Texture, minimalism and clean tailoring.", image: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1000&q=80" },
];

const testimonials = [
  { quote: "The quality is exceptional and the fit feels genuinely luxurious.", author: "Emily R." },
  { quote: "Beautifully designed pieces that feel premium without being overdone.", author: "Nicolas T." },
  { quote: "The entire shopping experience feels elevated and thoughtfully curated.", author: "Amina P." },
];

const socialPosts = [
  "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=700&q=80",
  "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=700&q=80",
  "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=700&q=80",
  "https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=700&q=80",
  "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=700&q=80",
  "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=700&q=80",
];

const newsletterSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address."),
});

type NewsletterValues = z.infer<typeof newsletterSchema>;

function getCatalogErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    if (error.code === "failed-precondition") {
      return "Firestore needs a catalog index. Deploy the indexes defined in firestore.indexes.json.";
    }
    if (error.code === "permission-denied") {
      return "Firestore denied access to the published catalog. Check the deployed Firestore rules.";
    }
  }
  return error instanceof Error ? error.message : "Product data could not be loaded.";
}

function createdAtMillis(value: unknown): number {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }
  return 0;
}

export default function Home() {
  const favorites = useWishlistStore((state) => state.favorites);
  const toggleFavorite = useWishlistStore((state) => state.toggleFavorite);
  const cartItems = useCartStore((state) => state.items);
  const addCartItem = useCartStore((state) => state.addItem);
  const setCartQuantity = useCartStore((state) => state.setQuantity);
  const removeCartItem = useCartStore((state) => state.removeItem);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cartNotice, setCartNotice] = useState<string | null>(null);
  const viewedProductIds = useRef(new Set<string>());
  const [newsletterMessage, setNewsletterMessage] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    try {
      getFirebaseAppCheck();
      const { db } = getFirebaseServices();
      const productsQuery = query(
        collection(db, "products"),
        where("status", "==", "published"),
        limit(24),
      );

      unsubscribe = onSnapshot(
        productsQuery,
        (snapshot) => {
          try {
            const publishedProducts = snapshot.docs
              .map((product) => parseProductDocument(product.id, product.data()))
              .sort((left, right) => createdAtMillis(right.createdAt) - createdAtMillis(left.createdAt));
            if (active) {
              setProducts(publishedProducts);
              setProductsError(null);
              setProductsLoading(false);
            }
          } catch (error) {
            if (active) {
              setProductsError(getCatalogErrorMessage(error));
              setProductsLoading(false);
            }
          }
        },
        (error) => {
          if (active) {
            setProductsError(getCatalogErrorMessage(error));
            setProductsLoading(false);
          }
        },
      );
    } catch (error) {
      const message = getCatalogErrorMessage(error);
      queueMicrotask(() => {
        if (active) {
          setProductsError(message);
          setProductsLoading(false);
        }
      });
    }

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const visibleProducts = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = !activeCategory || product.categoryId === activeCategory;
      const matchesSearch =
        !normalizedSearch ||
        product.name.toLowerCase().includes(normalizedSearch) ||
        product.categoryName.toLowerCase().includes(normalizedSearch);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, products, searchTerm]);

  const cartCount = cartItems.reduce((count, item) => count + item.quantity, 0);
  const cartSubtotals = cartItems.reduce<Record<string, number>>((totals, item) => {
    totals[item.currency] = (totals[item.currency] ?? 0) + item.priceMinor * item.quantity;
    return totals;
  }, {});

  const selectCategory = (categoryId: string | null) => {
    setActiveCategory(categoryId);
    setIsMenuOpen(false);
    document.getElementById("products")?.scrollIntoView({ behavior: "smooth" });
  };

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<NewsletterValues>({
    resolver: zodResolver(newsletterSchema),
    mode: "onBlur",
  });

  const onSubmit = async (values: NewsletterValues) => {
    setNewsletterMessage(null);

    try {
      await subscribeToNewsletter(values.email);
      reset();
      setNewsletterMessage({
        text: "Thank you for subscribing.",
        isError: false,
      });
    } catch (error) {
      setNewsletterMessage({
        text:
          error instanceof Error
            ? error.message
            : "Your subscription could not be saved. Please try again.",
        isError: true,
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#f3efe8] text-[#171717]">
      <div className="mx-auto max-w-[1680px] px-4 pb-16 pt-5 lg:px-6">
        <header className="sticky top-0 z-50 rounded-[18px] border border-[#e7ddd3] bg-[#f6f2ee]/95 px-5 py-4 shadow-[0_10px_30px_rgba(22,22,22,0.03)] backdrop-blur-md">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setIsMenuOpen((isOpen) => !isOpen)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#dccfc4] transition hover:bg-white lg:hidden"
                aria-label={isMenuOpen ? "Close menu" : "Open menu"}
                aria-expanded={isMenuOpen}
                aria-controls="mobile-navigation"
              >
                {isMenuOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
              <Link href="/" className="text-[2.2rem] leading-none font-display tracking-[0.12em] text-[#171717]">
                ÉLANO
              </Link>
            </div>

            <nav className="hidden items-center gap-8 text-[0.72rem] font-medium uppercase tracking-[0.16em] text-[#1e1e1e] lg:flex">
              {navItems.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => item.category && setActiveCategory(item.category)}
                  className="transition-opacity hover:opacity-70"
                >
                  {item.label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-3 text-[#1d1d1d]">
              <Link
                href="/account"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e3d8cd] bg-white/20 transition hover:border-[#d6c7b7]"
                aria-label="My account"
              >
                <User size={18} />
              </Link>
              <button
                type="button"
                onClick={() => setIsSearchOpen((isOpen) => !isOpen)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e3d8cd] bg-white/20 transition hover:border-[#d6c7b7]"
                aria-label={isSearchOpen ? "Close search" : "Search products"}
                aria-expanded={isSearchOpen}
              >
                {isSearchOpen ? <X size={18} /> : <Search size={18} />}
              </button>
              <button
                type="button"
                onClick={() => setIsCartOpen(true)}
                className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[#e3d8cd] bg-white/20 transition hover:border-[#d6c7b7]"
                aria-label={`Shopping bag, ${cartCount} items`}
              >
                <ShoppingBag size={18} />
                {cartCount > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#17243b] px-1 text-[0.6rem] font-semibold text-white">
                    {cartCount}
                  </span>
                ) : null}
              </button>
            </div>
          </div>

          {isMenuOpen ? (
            <nav id="mobile-navigation" className="mt-4 border-t border-[#e7ddd3] pt-3 lg:hidden">
              {navItems.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => {
                    if (item.category) {
                      setActiveCategory(item.category);
                    }
                    setIsMenuOpen(false);
                  }}
                  className="flex min-h-12 items-center justify-between border-b border-[#ece4db] text-sm font-medium uppercase tracking-[0.1em] last:border-0"
                >
                  {item.label}
                  <ChevronRight size={16} className="text-[#9a8060]" />
                </a>
              ))}
            </nav>
          ) : null}
        </header>

        {isSearchOpen ? (
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-3 sm:p-4">
            <Search size={18} className="shrink-0 text-[#746d68]" />
            <input
              type="search"
              autoFocus
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setActiveCategory(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  if (searchTerm.trim()) {
                    trackStoreEvent("search", { search_term: searchTerm.trim() });
                  }
                  document.getElementById("products")?.scrollIntoView({ behavior: "smooth" });
                }
              }}
              placeholder="Search products or collections"
              className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#9b948b]"
              aria-label="Search products"
            />
            {searchTerm ? (
              <button type="button" onClick={() => setSearchTerm("")} className="rounded-full p-2 text-[#746d68] hover:bg-[#f1ece5]" aria-label="Clear search">
                <X size={16} />
              </button>
            ) : null}
          </div>
        ) : null}

        <main className="mt-6 space-y-8">
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            className="overflow-hidden rounded-[28px] border border-[#e5dacd] bg-[#f7f3ee]"
          >
            <div className="grid min-h-[660px] lg:grid-cols-[0.9fr_1.6fr]">
              <div className="flex flex-col justify-between p-8 sm:p-10 lg:p-12 xl:p-16">
                <div className="space-y-6">
                  <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[#5b524a]">Free shipping on orders over $150</p>
                  <h1 className="max-w-[580px] font-display text-[4rem] leading-[0.82] tracking-[-0.07em] text-[#171717] sm:text-[5rem] lg:text-[6rem]">
                    Define
                    <span className="block text-[#171717]/80">your style</span>
                    <span className="block">own today</span>
                  </h1>
                  <p className="max-w-md text-base leading-7 text-[#4f4944]">
                    Premium quality. Timeless style. Made for the modern you.
                  </p>
                </div>

                <div className="mt-8 flex items-center gap-3">
                  <a href="#products" className="inline-flex items-center gap-2 rounded-full bg-[#17243b] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#101d30]">
                    Shop collection
                    <ArrowRight size={16} />
                  </a>
                </div>
              </div>

              <div className="relative min-h-[420px] overflow-hidden">
                <Image
                  src="https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1400&q=80"
                  alt="Fashion model in neutral tones"
                  fill
                  priority
                  sizes="(min-width: 1024px) 60vw, 100vw"
                  className="object-cover object-center contrast-[1.08]"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-[#f7f3ee]/15 via-transparent to-[#f7f3ee]/5" />
              </div>
            </div>
          </motion.section>

          <section className="grid gap-4 rounded-[26px] border border-[#e6ddd3] bg-[#f7f5f1] p-3 sm:grid-cols-2 lg:grid-cols-4 lg:p-4">
            {features.map(({ icon: Icon, title, copy }) => (
              <div key={title} className="flex items-center gap-4 rounded-[18px] border border-[#e8dfd4] bg-[#fbf8f5] px-4 py-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e1d5c9] bg-white text-[#17243b]">
                  <Icon size={17} />
                </div>
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="text-xs uppercase tracking-[0.12em] text-[#706961]">{copy}</div>
                </div>
              </div>
            ))}
          </section>

          <section id="categories" className="grid gap-5 lg:grid-cols-3">
            {categories.map((category, index) => (
              <motion.article
                key={category.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.5, delay: index * 0.08 }}
                className="group relative overflow-hidden rounded-[26px] border border-[#e7ddd3] bg-[#f4f0eb]"
              >
                <div className="relative h-[430px] overflow-hidden">
                  <Image
                    src={category.image}
                    alt={category.name}
                    fill
                    sizes="(min-width: 1024px) 33vw, 100vw"
                    className="object-cover transition duration-500 group-hover:scale-[1.04]"
                  />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a1017]/45 via-[#0a1017]/5 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-6 text-white">
                  <div>
                    <h2 className="font-display text-[2.2rem] leading-none tracking-[-0.05em]">{category.name}</h2>
                    <p className="mt-2 text-sm text-white/80">{category.subtitle}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => selectCategory(category.id)}
                    aria-label={`Shop ${category.name}`}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-white/50 bg-white/10 backdrop-blur-sm transition hover:bg-white/20"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </motion.article>
            ))}
          </section>

          <section id="products" className="scroll-mt-24 space-y-6 rounded-[28px] border border-[#e7ddd3] bg-[#f7f4f1] p-6 lg:p-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[#81776f]">
                  {activeCategory ? categories.find((item) => item.id === activeCategory)?.name : "The ÉLANO edit"}
                </p>
                <h2 className="font-display text-[3rem] leading-none tracking-[-0.06em] text-[#171717]">
                  {searchTerm ? `Results for “${searchTerm}”` : "Considered pieces, made to last"}
                </h2>
              </div>
              {activeCategory || searchTerm ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveCategory(null);
                    setSearchTerm("");
                  }}
                  className="hidden items-center gap-2 text-sm font-medium uppercase tracking-[0.16em] text-[#171717] md:inline-flex"
                >
                  Clear filters
                  <X size={15} />
                </button>
              ) : null}
            </div>

            {productsError ? (
              <div className="rounded-2xl border border-[#eed2cb] bg-[#fff5f2] p-5 text-sm text-[#8e3223]" role="alert">
                Product collection could not be loaded: {productsError}
              </div>
            ) : productsLoading ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading products">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="overflow-hidden rounded-[22px] border border-[#e7ddd3] bg-white/70">
                    <div className="aspect-[4/5] animate-pulse bg-[#e8dfd6]" />
                    <div className="space-y-3 p-4">
                      <div className="h-5 w-3/4 animate-pulse rounded bg-[#e8dfd6]" />
                      <div className="h-4 w-1/3 animate-pulse rounded bg-[#eee8e0]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : visibleProducts.length ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {visibleProducts.map((item, index) => {
                const isFavorite = Boolean(favorites[item.id]);

                return (
                  <motion.article
                    key={item.id}
                    onViewportEnter={() => {
                      if (viewedProductIds.current.has(item.id)) return;
                      viewedProductIds.current.add(item.id);
                      trackStoreEvent("view_item", {
                        currency: item.currency,
                        value: item.priceMinor / 100,
                        items: [{
                          item_id: item.id,
                          item_name: item.name,
                          item_category: item.categoryName,
                          price: item.priceMinor / 100,
                        }],
                      });
                    }}
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.2 }}
                    transition={{ duration: 0.45, delay: index * 0.05 }}
                    className="group overflow-hidden rounded-[22px] border border-[#e7ddd3] bg-white/70"
                  >
                    <div className="relative aspect-[4/5] overflow-hidden">
                      {item.imageUrl ? (
                        <Image
                          src={item.imageUrl}
                          alt={item.name}
                          fill
                          sizes="(min-width: 1280px) 25vw, (min-width: 768px) 50vw, 100vw"
                          className="object-cover transition duration-500 group-hover:scale-[1.05]"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-[#e8dfd6] text-xs uppercase tracking-[0.14em] text-[#746d68]">
                          Image coming soon
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleFavorite(item.id)}
                        className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-[#e3d7ca] bg-white/80 backdrop-blur-sm transition hover:scale-105"
                        aria-label={`Toggle favorite for ${item.name}`}
                        aria-pressed={isFavorite}
                      >
                        <Heart size={16} className={isFavorite ? "fill-[#17243b] text-[#17243b]" : "text-[#17243b]"} />
                      </button>
                    </div>
                    <div className="space-y-2 p-4">
                      <h3 className="text-lg font-medium tracking-[-0.03em] text-[#171717]">{item.name}</h3>
                      <p className="text-sm text-[#5e5850]">{item.categoryName}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-base font-semibold text-[#171717]">{formatProductPrice(item.priceMinor, item.currency)}</span>
                        <button
                          type="button"
                          disabled={item.stock <= 0}
                          onClick={() => {
                            addCartItem({
                              productId: item.id,
                              name: item.name,
                              priceMinor: item.priceMinor,
                              currency: item.currency,
                              imageUrl: item.imageUrl,
                            });
                            trackStoreEvent("add_to_cart", {
                              currency: item.currency,
                              value: item.priceMinor / 100,
                              items: [{
                                item_id: item.id,
                                item_name: item.name,
                                item_category: item.categoryName,
                                price: item.priceMinor / 100,
                                quantity: 1,
                              }],
                            });
                            setCartNotice(`${item.name} added to your bag.`);
                            setIsCartOpen(true);
                          }}
                          className="inline-flex items-center gap-1 rounded-full border border-[#d9cab9] bg-[#f8f2ea] px-3 py-1.5 text-[0.7rem] font-medium uppercase tracking-[0.14em] text-[#171717] transition hover:bg-[#efe5d8] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {item.stock > 0 ? "Add to bag" : "Sold out"}
                        </button>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#d8c9b9] bg-[#fbf8f5] px-5 py-12 text-center">
                <p className="font-display text-3xl">Nothing to show just yet</p>
                <p className="mt-2 text-sm text-[#746d68]">
                  {products.length === 0
                    ? "Published pieces will appear here as soon as they are available."
                    : "Try another search or collection."}
                </p>
              </div>
            )}
          </section>

          <section id="campaign" className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="overflow-hidden rounded-[28px] border border-[#e7ddd3] bg-[#ede6df]">
              <div className="p-6 lg:p-8">
                <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[#716a63]">Most loved styles</p>
                <h2 className="mt-2 font-display text-[2.8rem] leading-none tracking-[-0.06em] text-[#171717]">The understated essentials</h2>
              </div>
              <div className="grid gap-4 p-6 lg:grid-cols-3">
                {inspiration.map((item, index) => (
                  <motion.div key={item.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.45, delay: index * 0.07 }} className="overflow-hidden rounded-[20px] border border-[#e6dccc] bg-white/40">
                    <div className="relative h-[270px]">
                      <Image
                        src={item.image}
                        alt={item.title}
                        fill
                        sizes="(min-width: 1280px) 25vw, (min-width: 768px) 50vw, 100vw"
                        className="object-cover"
                      />
                    </div>
                    <div className="space-y-2 p-4">
                      <h3 className="font-display text-[2rem] leading-none tracking-[-0.04em] text-[#171717]">{item.title}</h3>
                      <p className="text-sm text-[#4f4a46]">{item.copy}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[28px] border border-[#e7ddd3] bg-[#17243b] p-7 text-white">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),transparent_40%)]" />
              <div className="relative flex h-full flex-col justify-between gap-10">
                <div>
                  <p className="text-[0.72rem] uppercase tracking-[0.18em] text-white/70">Summer sale</p>
                  <h2 className="mt-4 font-display text-[4rem] leading-[0.82] tracking-[-0.06em]">Up to 40% off</h2>
                </div>
                <div className="rounded-[22px] border border-white/15 bg-white/5 p-5 backdrop-blur-sm">
                  <p className="text-sm uppercase tracking-[0.16em] text-white/70">Curated collection</p>
                  <p className="mt-3 text-base leading-7 text-white/80">Light layers, elevated neutrals, and versatile essentials for warm-day dressing.</p>
                  <button className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-[#17243b] transition hover:bg-[#edf2f7]">
                    Shop now
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section id="inspiration" className="rounded-[28px] border border-[#e7ddd3] bg-[#f8f5f2] p-6 lg:p-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[#746d68]">Style inspiration</p>
                <h2 className="font-display text-[3rem] leading-none tracking-[-0.06em] text-[#171717]">Fresh looks, styled for everyday life</h2>
              </div>
              <button className="hidden items-center gap-2 text-sm font-medium uppercase tracking-[0.16em] text-[#171717] md:inline-flex">
                View all
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-3">
              {socialPosts.slice(0, 3).map((image, index) => (
                <motion.div key={image} initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.5, delay: index * 0.08 }} className="relative h-[420px] overflow-hidden rounded-[22px] border border-[#e6ddd3] bg-white">
                  <Image
                    src={image}
                    alt="Editorial fashion inspiration"
                    fill
                    sizes="(min-width: 1024px) 33vw, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              ))}
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-3">
            {testimonials.map((item, index) => (
              <motion.blockquote key={item.author} initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.45, delay: index * 0.08 }} className="rounded-[24px] border border-[#e7ddd3] bg-[#f7f3ee] p-6">
                <div className="mb-5 flex items-center gap-1 text-[#17243b]">
                  {Array.from({ length: 5 }).map((_, starIndex) => (
                    <Star key={`${item.author}-${starIndex}`} size={15} className="fill-current" />
                  ))}
                </div>
                <p className="text-lg leading-8 text-[#1c1b1a]">“{item.quote}”</p>
                <footer className="mt-5 text-sm uppercase tracking-[0.18em] text-[#6a635f]">{item.author}</footer>
              </motion.blockquote>
            ))}
          </section>

          <section className="rounded-[26px] border border-[#e5dacd] bg-[#171d2a] p-6 text-white lg:p-8">
            <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.18em] text-white/70">Crafted for real life</p>
                <h2 className="mt-3 font-display text-[3.5rem] leading-[0.9] tracking-[-0.06em]">
                  Wear quality.
                  <span className="block text-white/80">Live confident.</span>
                </h2>
                <p className="mt-4 max-w-xl text-base leading-7 text-white/75">
                  Carefully selected materials and refined silhouettes designed to last beyond the season.
                </p>
                <button className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#171d2a] transition hover:bg-[#edf2f7]">
                  Discover more
                  <ArrowRight size={16} />
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {["Considered pieces", "Thoughtful materials", "Made for repeat wear", "Designed to endure"].map((item) => (
                  <div key={item} className="rounded-[20px] border border-white/10 bg-white/5 p-5">
                    <div className="font-display text-[1.7rem] tracking-[-0.04em]">{item}</div>
                    <div className="mt-2 text-sm uppercase tracking-[0.14em] text-white/55">The ÉLANO approach</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-[#e9dfd3] bg-[#f8f4f0] p-6 lg:p-8">
            <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[#6e675f]">Stay in touch</p>
                <h2 className="mt-2 font-display text-[3rem] leading-none tracking-[-0.06em] text-[#171717]">Join our newsletter</h2>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3 sm:flex-row">
                <div className="flex-1">
                  <input
                    type="email"
                    {...register("email")}
                    placeholder="Enter your email"
                    className="h-14 w-full rounded-full border border-[#d8c9b9] bg-white px-5 text-sm text-[#171717] outline-none transition focus:border-[#17243b]"
                    aria-invalid={Boolean(errors.email)}
                  />
                  {errors.email ? (
                    <p className="mt-2 text-xs text-[#a33f2f]">{errors.email.message}</p>
                  ) : null}
                </div>
                <button type="submit" disabled={isSubmitting} className="h-14 rounded-full bg-[#17243b] px-6 text-sm font-medium uppercase tracking-[0.12em] text-white transition hover:bg-[#101d30] disabled:opacity-70">
                  {isSubmitting ? "Sending..." : "Subscribe"}
                </button>
              </form>
              {newsletterMessage ? (
                <p
                  className={`mt-3 text-sm ${
                    newsletterMessage.isError ? "text-[#a33f2f]" : "text-[#315c41]"
                  }`}
                  role={newsletterMessage.isError ? "alert" : "status"}
                  aria-live="polite"
                >
                  {newsletterMessage.text}
                </p>
              ) : null}
            </div>
          </section>
        </main>

        <footer className="mt-8 border-t border-[#e5dccd] pt-8 text-[#231f1b]">
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <div className="font-display text-[2.4rem] leading-none tracking-[0.12em]">ÉLANO</div>
              <p className="mt-4 max-w-md text-sm leading-7 text-[#57514b]">
                Premium essentials for modern wardrobes — refined silhouettes, tactile fabrics and timeless utility.
              </p>
            </div>

            <div>
              <h3 className="text-xs uppercase tracking-[0.18em] text-[#615b56]">Shop</h3>
              <ul className="mt-4 space-y-3 text-sm text-[#2a2724]">
                <li><a href="#">New In</a></li>
                <li><a href="#">Women</a></li>
                <li><a href="#">Men</a></li>
                <li><a href="#">Accessories</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs uppercase tracking-[0.18em] text-[#615b56]">Support</h3>
              <ul className="mt-4 space-y-3 text-sm text-[#2a2724]">
                <li><a href="#">Shipping</a></li>
                <li><a href="#">Returns</a></li>
                <li><a href="#">Contact</a></li>
                <li><a href="#">FAQ</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs uppercase tracking-[0.18em] text-[#615b56]">Follow</h3>
              <ul className="mt-4 space-y-3 text-sm text-[#2a2724]">
                <li><a href="#">Instagram</a></li>
                <li><a href="#">Pinterest</a></li>
                <li><a href="#">Facebook</a></li>
                <li><a href="#">TikTok</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 border-t border-[#e5dccd] pt-5 text-sm text-[#5d5752] sm:flex-row sm:items-center sm:justify-between">
            <p>© 2025 ÉLANO. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <a href="#">Privacy policy</a>
              <a href="#">Terms</a>
              <a href="#">Cookies</a>
            </div>
          </div>
        </footer>

        <AnimatePresence>
          {isCartOpen ? (
            <motion.div
              className="fixed inset-0 z-[70] flex justify-end bg-[#101721]/45 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setIsCartOpen(false);
                }
              }}
            >
              <motion.aside
                role="dialog"
                aria-modal="true"
                aria-labelledby="cart-title"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "tween", duration: 0.25 }}
                className="flex h-full w-full max-w-md flex-col bg-[#f8f4ef] p-5 shadow-2xl sm:p-7"
              >
                <div className="flex items-start justify-between border-b border-[#e5dacd] pb-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-[#81776f]">Your selection</p>
                    <h2 id="cart-title" className="mt-1 font-display text-4xl">The bag <span className="text-2xl text-[#81776f]">({cartCount})</span></h2>
                  </div>
                  <button type="button" onClick={() => setIsCartOpen(false)} className="rounded-full border border-[#dfd4c9] p-2" aria-label="Close shopping bag">
                    <X size={18} />
                  </button>
                </div>

                {cartNotice ? (
                  <p className="mt-4 rounded-xl border border-[#cfe0d3] bg-[#f2f8f3] px-4 py-3 text-sm text-[#315c41]" role="status">
                    {cartNotice}
                  </p>
                ) : null}

                {cartItems.length ? (
                  <>
                    <div className="mt-5 flex-1 space-y-4 overflow-y-auto">
                      {cartItems.map((item) => (
                        <article key={item.productId} className="flex gap-4 border-b border-[#e9dfd5] pb-4">
                          <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-xl bg-[#e8dfd6]">
                            {item.imageUrl ? (
                              <Image src={item.imageUrl} alt="" fill sizes="80px" className="object-cover" />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate font-medium">{item.name}</h3>
                            <p className="mt-1 text-sm text-[#706961]">{formatProductPrice(item.priceMinor, item.currency)}</p>
                            <div className="mt-3 flex items-center justify-between">
                              <div className="flex items-center gap-3 rounded-full border border-[#dfd4c9] bg-white px-2 py-1">
                                <button
                                  type="button"
                                  onClick={() => setCartQuantity(item.productId, item.quantity - 1)}
                                  className="p-1"
                                  aria-label={`Decrease ${item.name} quantity`}
                                >
                                  <Minus size={14} />
                                </button>
                                <span className="min-w-4 text-center text-sm">{item.quantity}</span>
                                <button
                                  type="button"
                                  onClick={() => setCartQuantity(item.productId, item.quantity + 1)}
                                  className="p-1"
                                  aria-label={`Increase ${item.name} quantity`}
                                >
                                  <Plus size={14} />
                                </button>
                              </div>
                              <button type="button" onClick={() => removeCartItem(item.productId)} className="p-2 text-[#746d68] hover:text-[#a33f2f]" aria-label={`Remove ${item.name}`}>
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                    <div className="border-t border-[#e5dacd] pt-5">
                      <div className="flex justify-between font-medium">
                        <span>Subtotal</span>
                        {Object.entries(cartSubtotals).map(([currency, total]) => (
                          <span key={currency}>{formatProductPrice(total, currency)}</span>
                        ))}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-[#81776f]">
                        Shipping, taxes, and final availability are confirmed at checkout.
                      </p>
                      <button type="button" disabled className="mt-5 h-12 w-full rounded-full bg-[#17243b] text-sm font-medium text-white opacity-70" title="Checkout will be available when secure order processing is configured.">
                        Checkout is not available yet
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center text-center">
                    <ShoppingBag size={26} className="text-[#9a8060]" />
                    <p className="mt-4 font-display text-3xl">Your bag is waiting</p>
                    <p className="mt-2 max-w-xs text-sm leading-6 text-[#746d68]">Explore the collection and add a piece that feels like you.</p>
                    <button type="button" onClick={() => setIsCartOpen(false)} className="mt-5 rounded-full bg-[#17243b] px-5 py-3 text-sm font-medium text-white">
                      Continue exploring
                    </button>
                  </div>
                )}
              </motion.aside>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
