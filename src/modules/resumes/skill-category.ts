/**
 * Deterministic skill category from the Phase 4 skill lexicon (no AI). Used when a candidate
 * confirms a job skill they have, so it lands in a sensible resume group (React → Web, not AI).
 */
import type { SKILL_CATEGORIES } from "@/modules/candidate/options";
import { canonicalSkillKey } from "@/modules/matching/skills";

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

const BY_KEY: Record<string, SkillCategory> = {};
const put = (category: SkillCategory, keys: string) =>
  keys.split(" ").forEach((k) => (BY_KEY[k] = category));
put(
  "WEB",
  "javascript typescript html css sass tailwind react react-native nextjs vue angular svelte nodejs express wordpress webflow shopify wix rest-api graphql api-integration vercel",
);
put(
  "TECHNICAL",
  "python java golang php ruby csharp cpp django flask fastapi git github docker kubernetes aws gcp azure supabase firebase sql postgresql mysql mongodb pandas data-analysis machine-learning statistics",
);
put("AI", "llm prompt-engineering openai-api langchain rag ai-agents");
put("AUTOMATION", "n8n zapier make-com power-automate airtable rpa uipath marketing-automation");
put(
  "MARKETING",
  "seo sem ppc google-ads linkedin-ads tiktok-ads ga4 google-analytics google-tag-manager search-console semrush ahrefs email-marketing content-marketing social-media-marketing social-media-management performance-marketing digital-marketing growth-marketing influencer-marketing affiliate-marketing conversion-rate-optimization ab-testing brand-strategy market-research public-relations community-management mailchimp klaviyo ecommerce amazon-seller-central",
);
put("CONTENT", "copywriting content-writing video-editing");
put(
  "DESIGN",
  "figma canva photoshop illustrator premiere-pro after-effects capcut graphic-design ui-design ux-design",
);
put(
  "SALES",
  "lead-generation cold-calling cold-emailing b2b-sales account-management business-development negotiation apollo linkedin-sales-navigator hubspot salesforce zoho-crm crm",
);
put(
  "BUSINESS",
  "excel google-sheets power-bi tableau looker-studio looker project-management product-management jira asana trello agile financial-modeling customer-support stakeholder-management microsoft-office google-workspace notion",
);

export function inferSkillCategory(name: string): SkillCategory {
  const key = canonicalSkillKey(name);
  if (key && BY_KEY[key]) return BY_KEY[key];
  // Common spellings the lexicon keeps as free text.
  if (/\bapi(s)?\b.*integrat|integrat.*\bapi/i.test(name)) return "WEB";
  return "OTHER";
}
