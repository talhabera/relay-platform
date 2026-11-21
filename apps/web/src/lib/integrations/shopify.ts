// TODO: Replace mock data with real Shopify Storefront API calls
// Will need: shopify access token, store domain from integration config

export interface ShopifyCollection {
  id: string;
  handle: string;
  title: string;
  description: string;
  imageUrl: string | null;
  productCount: number;
}

export interface ShopifyProduct {
  id: string;
  title: string;
  description: string;
  handle: string;
  vendor: string;
  productType: string;
  tags: string[];
  price: number;
  compareAtPrice: number | null;
  currency: string;
  available: boolean;
  imageUrl: string | null;
  collection: string;
  variants: ShopifyVariant[];
}

export interface ShopifyVariant {
  id: string;
  title: string;
  price: number;
  available: boolean;
  sku: string | null;
}

export interface SearchProductsParams {
  collection?: string;
  minPrice?: number;
  maxPrice?: number;
  tags?: string[];
  inStock?: boolean;
}

// --- Mock Data ---

const MOCK_COLLECTIONS: ShopifyCollection[] = [
  {
    id: "col_001",
    handle: "summer-collection",
    title: "Summer Collection",
    description: "Light and breezy styles for the warm season",
    imageUrl: null,
    productCount: 12,
  },
  {
    id: "col_002",
    handle: "essentials",
    title: "Essentials",
    description: "Everyday basics that never go out of style",
    imageUrl: null,
    productCount: 24,
  },
  {
    id: "col_003",
    handle: "new-arrivals",
    title: "New Arrivals",
    description: "The latest additions to our catalog",
    imageUrl: null,
    productCount: 8,
  },
  {
    id: "col_004",
    handle: "sale",
    title: "Sale",
    description: "Great deals on selected items",
    imageUrl: null,
    productCount: 15,
  },
];

const MOCK_PRODUCTS: ShopifyProduct[] = [
  {
    id: "prod_001",
    title: "Classic Cotton T-Shirt",
    description: "A comfortable everyday t-shirt made from 100% organic cotton",
    handle: "classic-cotton-tshirt",
    vendor: "Relay Basics",
    productType: "T-Shirts",
    tags: ["cotton", "basics", "unisex"],
    price: 29.99,
    compareAtPrice: null,
    currency: "USD",
    available: true,
    imageUrl: null,
    collection: "essentials",
    variants: [
      { id: "var_001a", title: "Small", price: 29.99, available: true, sku: "CT-S" },
      { id: "var_001b", title: "Medium", price: 29.99, available: true, sku: "CT-M" },
      { id: "var_001c", title: "Large", price: 29.99, available: true, sku: "CT-L" },
      { id: "var_001d", title: "XL", price: 29.99, available: false, sku: "CT-XL" },
    ],
  },
  {
    id: "prod_002",
    title: "Linen Summer Shirt",
    description: "Lightweight linen shirt perfect for hot days",
    handle: "linen-summer-shirt",
    vendor: "Relay Basics",
    productType: "Shirts",
    tags: ["linen", "summer", "lightweight"],
    price: 59.99,
    compareAtPrice: 79.99,
    currency: "USD",
    available: true,
    imageUrl: null,
    collection: "summer-collection",
    variants: [
      { id: "var_002a", title: "Small", price: 59.99, available: true, sku: "LS-S" },
      { id: "var_002b", title: "Medium", price: 59.99, available: true, sku: "LS-M" },
      { id: "var_002c", title: "Large", price: 59.99, available: false, sku: "LS-L" },
    ],
  },
  {
    id: "prod_003",
    title: "Premium Denim Jeans",
    description: "Slim-fit jeans crafted from premium stretch denim",
    handle: "premium-denim-jeans",
    vendor: "Relay Denim",
    productType: "Jeans",
    tags: ["denim", "premium", "slim-fit"],
    price: 89.99,
    compareAtPrice: null,
    currency: "USD",
    available: true,
    imageUrl: null,
    collection: "essentials",
    variants: [
      { id: "var_003a", title: "30x30", price: 89.99, available: true, sku: "DJ-30" },
      { id: "var_003b", title: "32x32", price: 89.99, available: true, sku: "DJ-32" },
      { id: "var_003c", title: "34x32", price: 89.99, available: true, sku: "DJ-34" },
    ],
  },
  {
    id: "prod_004",
    title: "Beach Sandals",
    description: "Comfortable sandals for beach and casual wear",
    handle: "beach-sandals",
    vendor: "Relay Footwear",
    productType: "Footwear",
    tags: ["summer", "beach", "casual"],
    price: 34.99,
    compareAtPrice: 44.99,
    currency: "USD",
    available: false,
    imageUrl: null,
    collection: "summer-collection",
    variants: [
      { id: "var_004a", title: "Size 8", price: 34.99, available: false, sku: "BS-8" },
      { id: "var_004b", title: "Size 9", price: 34.99, available: false, sku: "BS-9" },
      { id: "var_004c", title: "Size 10", price: 34.99, available: false, sku: "BS-10" },
    ],
  },
  {
    id: "prod_005",
    title: "Wool Blend Sweater",
    description: "Warm and cozy sweater made from a merino wool blend",
    handle: "wool-blend-sweater",
    vendor: "Relay Knitwear",
    productType: "Sweaters",
    tags: ["wool", "winter", "premium"],
    price: 109.99,
    compareAtPrice: 139.99,
    currency: "USD",
    available: true,
    imageUrl: null,
    collection: "sale",
    variants: [
      { id: "var_005a", title: "Small", price: 109.99, available: true, sku: "WS-S" },
      { id: "var_005b", title: "Medium", price: 109.99, available: true, sku: "WS-M" },
      { id: "var_005c", title: "Large", price: 109.99, available: true, sku: "WS-L" },
    ],
  },
];

// --- Public Functions ---

/**
 * Get all Shopify collections.
 * TODO: Replace with real Shopify Storefront API call
 */
export async function getCollections(): Promise<{
  collections: ShopifyCollection[];
}> {
  return { collections: MOCK_COLLECTIONS };
}

/**
 * Search products with optional filters.
 * TODO: Replace with real Shopify Storefront API call using GraphQL
 */
export async function searchProducts(
  params: SearchProductsParams
): Promise<{ products: ShopifyProduct[]; total: number }> {
  let filtered = [...MOCK_PRODUCTS];

  if (params.collection) {
    filtered = filtered.filter((p) => p.collection === params.collection);
  }

  if (params.minPrice !== undefined) {
    filtered = filtered.filter((p) => p.price >= params.minPrice!);
  }

  if (params.maxPrice !== undefined) {
    filtered = filtered.filter((p) => p.price <= params.maxPrice!);
  }

  if (params.tags && params.tags.length > 0) {
    filtered = filtered.filter((p) =>
      params.tags!.some((tag) => p.tags.includes(tag))
    );
  }

  if (params.inStock !== undefined) {
    filtered = filtered.filter((p) => p.available === params.inStock);
  }

  return {
    products: filtered,
    total: filtered.length,
  };
}
