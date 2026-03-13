/**
 * Subscription Tier Configuration
 * Defines pricing, credits, and limits for each subscription tier
 */

export const SubscriptionTiers = {
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD: 'gold',
};

export const TierConfig = {
  [SubscriptionTiers.BRONZE]: {
    name: 'Bronze',
    priceMonthly: 9900, // £99.00 in pence
    credits: 5,
    maxShortlists: 1,
    maxCandidatesPerShortlist: 10,
    maxTeamMembers: 1,
    description: '5 contact credits/month, 1 shortlist (10 candidates), 1 team member',
    features: [
      '5 contact requests per month',
      '1 shortlist with up to 10 candidates',
      'Basic candidate search',
      'Email support',
    ],
  },
  [SubscriptionTiers.SILVER]: {
    name: 'Silver',
    priceMonthly: 24900, // £249.00 in pence
    credits: 20,
    maxShortlists: 3,
    maxCandidatesPerShortlist: 25,
    maxTeamMembers: 3,
    description: '20 contact credits/month, 3 shortlists (25 candidates each), 3 team members',
    features: [
      '20 contact requests per month',
      '3 shortlists with up to 25 candidates each',
      'Advanced candidate search',
      'Priority email support',
      'Team collaboration (3 members)',
    ],
  },
  [SubscriptionTiers.GOLD]: {
    name: 'Gold',
    priceMonthly: 49900, // £499.00 in pence
    credits: -1, // -1 indicates unlimited
    maxShortlists: -1, // Unlimited
    maxCandidatesPerShortlist: -1, // Unlimited
    maxTeamMembers: 10,
    description: 'Unlimited contact credits, unlimited shortlists, 10 team members',
    features: [
      'Unlimited contact requests',
      'Unlimited shortlists with unlimited candidates',
      'Full candidate profile access',
      'Dedicated account manager',
      'Phone & email support',
      'Team collaboration (10 members)',
      'API access',
    ],
  },
};

/**
 * Check if a tier has unlimited credits
 */
export function hasUnlimitedCredits(tier) {
  const config = TierConfig[tier];
  return config?.credits === -1;
}

/**
 * Get credits for a tier
 */
export function getTierCredits(tier) {
  const config = TierConfig[tier];
  return config?.credits ?? 0;
}

/**
 * Get shortlist limits for a tier
 */
export function getShortlistLimits(tier) {
  const config = TierConfig[tier];
  return {
    maxShortlists: config?.maxShortlists ?? 0,
    maxCandidatesPerShortlist: config?.maxCandidatesPerShortlist ?? 0,
  };
}

/**
 * Check if tier has unlimited shortlists
 */
export function hasUnlimitedShortlists(tier) {
  const config = TierConfig[tier];
  return config?.maxShortlists === -1;
}

/**
 * Get Stripe price ID for tier (from environment)
 */
export function getStripePriceId(tier) {
  switch (tier) {
    case SubscriptionTiers.BRONZE:
      return process.env.STRIPE_BRONZE_PRICE_ID;
    case SubscriptionTiers.SILVER:
      return process.env.STRIPE_SILVER_PRICE_ID;
    case SubscriptionTiers.GOLD:
      return process.env.STRIPE_GOLD_PRICE_ID;
    default:
      return null;
  }
}

/**
 * Get tier from Stripe price ID
 */
export function getTierFromPriceId(priceId) {
  if (priceId === process.env.STRIPE_BRONZE_PRICE_ID) {
    return SubscriptionTiers.BRONZE;
  }
  if (priceId === process.env.STRIPE_SILVER_PRICE_ID) {
    return SubscriptionTiers.SILVER;
  }
  if (priceId === process.env.STRIPE_GOLD_PRICE_ID) {
    return SubscriptionTiers.GOLD;
  }
  return null;
}

/**
 * Subscription status values
 */
export const SubscriptionStatus = {
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELLED: 'cancelled',
  TRIALING: 'trialing',
};
