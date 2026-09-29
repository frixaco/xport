export function creditProducts() {
  const prefix = process.env.POLAR_ENV === "production" ? "" : "SANDBOX_";
  return [
    {
      productId: process.env[`${prefix}POLAR_CREDITS_50_CREDITS_PRODUCT_ID`]!,
      slug: "credits-125",
      credits: 125,
    },
    {
      productId: process.env[`${prefix}POLAR_CREDITS_500_CREDITS_PRODUCT_ID`]!,
      slug: "credits-1250",
      credits: 1250,
    },
  ];
}
