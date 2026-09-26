import { foldText, termRegex } from "@/modules/search-profiles/criteria";

/**
 * Skill normalisation lexicon (client-safe, versioned with the extractor/matcher).
 *
 *  - `aliases` are TRUE equivalents: different spellings/abbreviations of the same skill
 *    (JS = JavaScript, GA4 = Google Analytics 4). They produce EXACT matches.
 *  - `related` are explicit, reviewed relationships (Google Analytics ↔ GA4). They
 *    produce RELATED matches, never EXACT ones.
 *  - Anything not listed is compared by its normalised name only. Broad equivalences
 *    (React ≠ Angular, Photoshop ≠ Figma, Digital Marketing ≠ Performance Marketing)
 *    are deliberately NOT encoded.
 * Ambiguous short names (Go, R, C, Make) are only recognised by unambiguous spellings.
 */

export const SKILL_LEXICON_VERSION = "skills-1";

export interface SkillDef {
  key: string;
  name: string;
  aliases?: readonly string[];
  related?: readonly string[];
  /** Equivalent only as a complete skill name ("Excel"), never scanned in free text ("excel at …") */
  nameOnly?: readonly string[];
}

const S = (
  key: string,
  name: string,
  aliases: string[] = [],
  related: string[] = [],
  nameOnly: string[] = [],
): SkillDef => ({ key, name, aliases, related, nameOnly });

export const SKILLS: readonly SkillDef[] = [
  // --- Programming & web -----------------------------------------------------------
  S("javascript", "JavaScript", ["JS", "ECMAScript"], ["typescript"]),
  S("typescript", "TypeScript", [], ["javascript"], ["TS"]),
  S("python", "Python"),
  S("java", "Java"),
  S("golang", "Go (Golang)", ["Golang"], [], ["Go"]),
  S("php", "PHP"),
  S("ruby", "Ruby"),
  S("csharp", "C#", ["C Sharp"]),
  S("cpp", "C++"),
  S("html", "HTML", ["HTML5"]),
  S("css", "CSS", ["CSS3"], ["tailwind", "sass"]),
  S("sass", "Sass", ["SCSS"], ["css"]),
  S("tailwind", "Tailwind CSS", ["Tailwind"], ["css"]),
  S("react", "React", ["React.js", "ReactJS"], ["nextjs", "react-native"]),
  S("react-native", "React Native", [], ["react"]),
  S("nextjs", "Next.js", ["NextJS", "Next js"], ["react"]),
  S("vue", "Vue.js", ["Vue", "VueJS"]),
  S("angular", "Angular", ["AngularJS"]),
  S("svelte", "Svelte"),
  S("nodejs", "Node.js", ["NodeJS"], ["javascript"], ["Node"]),
  S("express", "Express.js", ["ExpressJS"], ["nodejs"]),
  S("django", "Django", [], ["python"]),
  S("flask", "Flask", [], ["python"]),
  S("fastapi", "FastAPI", [], ["python"]),
  S("rest-api", "REST APIs", ["RESTful APIs", "RESTful", "REST API"], [], ["REST"]),
  S("graphql", "GraphQL"),
  S("wordpress", "WordPress", [], [], ["WP"]),
  S("webflow", "Webflow"),
  S("shopify", "Shopify"),
  S("wix", "Wix"),
  S("git", "Git", [], ["github"]),
  S("github", "GitHub", [], ["git"]),
  S("docker", "Docker"),
  S("kubernetes", "Kubernetes", ["K8s"]),
  S("aws", "AWS", ["Amazon Web Services"]),
  S("gcp", "Google Cloud", ["GCP", "Google Cloud Platform"]),
  S("azure", "Microsoft Azure", ["Azure"]),
  S("vercel", "Vercel"),
  S("supabase", "Supabase", [], ["postgresql"]),
  S("firebase", "Firebase"),
  // --- Data ----------------------------------------------------------------------
  S("sql", "SQL", [], ["postgresql", "mysql"]),
  S("postgresql", "PostgreSQL", ["Postgres"], ["sql"]),
  S("mysql", "MySQL", [], ["sql"]),
  S("mongodb", "MongoDB", [], [], ["Mongo"]),
  S("excel", "Microsoft Excel", ["MS Excel", "Excel spreadsheets"], ["google-sheets"], ["Excel"]),
  S("google-sheets", "Google Sheets", [], ["excel"]),
  S("power-bi", "Power BI", ["PowerBI"]),
  S("tableau", "Tableau"),
  S("looker-studio", "Looker Studio", ["Google Data Studio", "Data Studio"]),
  S("looker", "Looker"),
  S("pandas", "pandas", [], ["python"]),
  S("data-analysis", "Data analysis", ["Data analytics"]),
  S("machine-learning", "Machine learning", [], [], ["ML"]),
  S("statistics", "Statistics"),
  // --- AI & automation ---------------------------------------------------------------
  S("llm", "Large language models", ["LLM", "LLMs"], ["prompt-engineering", "openai-api"]),
  S("prompt-engineering", "Prompt engineering", [], ["llm"]),
  S("openai-api", "OpenAI API", ["ChatGPT API", "GPT API"], ["llm"]),
  S("langchain", "LangChain", [], ["llm"]),
  S("rag", "Retrieval-augmented generation", ["RAG"], ["llm"]),
  S("ai-agents", "AI agents", ["AI agent", "Agentic AI"], ["llm"]),
  S("n8n", "n8n", [], ["zapier", "make-com"]),
  S("zapier", "Zapier", [], ["n8n", "make-com"]),
  S("make-com", "Make.com", ["Integromat", "Make (Integromat)"], ["zapier", "n8n"], ["Make"]),
  S("power-automate", "Power Automate", ["Microsoft Power Automate"]),
  S("airtable", "Airtable"),
  S("notion", "Notion"),
  S("rpa", "Robotic process automation", ["RPA"], ["uipath"]),
  S("uipath", "UiPath", [], ["rpa"]),
  S("api-integration", "API integrations", ["API integration", "Webhooks"]),
  // --- Marketing -----------------------------------------------------------------------
  S("seo", "SEO", ["Search Engine Optimization", "Search Engine Optimisation"], ["sem"]),
  S("sem", "SEM", ["Search Engine Marketing"], ["google-ads", "seo"]),
  S("ppc", "PPC", ["Pay-per-click", "Pay per click"], ["google-ads", "meta-ads"]),
  S("google-ads", "Google Ads", ["Google AdWords", "AdWords"], ["sem", "ppc"]),
  S(
    "meta-ads",
    "Meta Ads",
    ["Facebook Ads", "Instagram Ads", "Meta Ads Manager", "Facebook Ads Manager"],
    ["ppc"],
  ),
  S("linkedin-ads", "LinkedIn Ads"),
  S("tiktok-ads", "TikTok Ads"),
  S("ga4", "Google Analytics 4", ["GA4", "GA 4"], ["google-analytics"]),
  S("google-analytics", "Google Analytics", ["Universal Analytics"], ["ga4"]),
  S("google-tag-manager", "Google Tag Manager", ["GTM"]),
  S("search-console", "Google Search Console", ["Search Console"], ["seo"]),
  S("semrush", "Semrush", ["SEMrush"], ["seo"]),
  S("ahrefs", "Ahrefs", [], ["seo"]),
  S("hubspot", "HubSpot", [], ["crm"]),
  S("salesforce", "Salesforce", ["SFDC"], ["crm"]),
  S("zoho-crm", "Zoho CRM", ["Zoho"], ["crm"]),
  S("crm", "CRM", ["Customer relationship management"]),
  S("mailchimp", "Mailchimp", [], ["email-marketing"]),
  S("klaviyo", "Klaviyo", [], ["email-marketing"]),
  S("email-marketing", "Email marketing"),
  S("marketing-automation", "Marketing automation"),
  S("content-marketing", "Content marketing"),
  S("copywriting", "Copywriting"),
  S("content-writing", "Content writing"),
  S("social-media-marketing", "Social media marketing", ["SMM"]),
  S("social-media-management", "Social media management"),
  S("performance-marketing", "Performance marketing"),
  S("digital-marketing", "Digital marketing"),
  S("growth-marketing", "Growth marketing", ["Growth hacking"]),
  S("influencer-marketing", "Influencer marketing"),
  S("affiliate-marketing", "Affiliate marketing"),
  S("conversion-rate-optimization", "Conversion rate optimization", [
    "CRO",
    "Conversion rate optimisation",
  ]),
  S("ab-testing", "A/B testing", ["AB testing", "Split testing"]),
  S("brand-strategy", "Brand strategy", ["Branding"]),
  S("market-research", "Market research"),
  S("public-relations", "Public relations", [], [], ["PR"]),
  S("community-management", "Community management"),
  S("ecommerce", "E-commerce", ["Ecommerce", "eCommerce"]),
  S("amazon-seller-central", "Amazon Seller Central"),
  // --- Design & content ------------------------------------------------------------------
  S("figma", "Figma"),
  S("canva", "Canva"),
  S("photoshop", "Adobe Photoshop", ["Photoshop"]),
  S("illustrator", "Adobe Illustrator", ["Illustrator"]),
  S("premiere-pro", "Adobe Premiere Pro", ["Premiere Pro"]),
  S("after-effects", "Adobe After Effects", ["After Effects"]),
  S("capcut", "CapCut"),
  S("video-editing", "Video editing"),
  S("graphic-design", "Graphic design"),
  S("ui-design", "UI design", ["User interface design"], ["ux-design"]),
  S("ux-design", "UX design", ["User experience design"], ["ui-design"]),
  // --- Sales & business ----------------------------------------------------------------
  S("lead-generation", "Lead generation", ["Lead gen"]),
  S("cold-calling", "Cold calling"),
  S("cold-emailing", "Cold emailing", ["Cold email", "Cold outreach"]),
  S("b2b-sales", "B2B sales"),
  S("account-management", "Account management"),
  S("business-development", "Business development", [], [], ["BD"]),
  S("negotiation", "Negotiation"),
  S("apollo", "Apollo.io", [], [], ["Apollo"]),
  S("linkedin-sales-navigator", "LinkedIn Sales Navigator", ["Sales Navigator"]),
  S("project-management", "Project management"),
  S("product-management", "Product management"),
  S("jira", "Jira"),
  S("asana", "Asana"),
  S("trello", "Trello"),
  S("agile", "Agile", ["Scrum"]),
  S("financial-modeling", "Financial modeling", ["Financial modelling"]),
  S("customer-support", "Customer support", ["Customer service"]),
  S("stakeholder-management", "Stakeholder management"),
  S("microsoft-office", "Microsoft Office", ["MS Office", "Microsoft 365", "Office 365"]),
  S("google-workspace", "Google Workspace", ["G Suite", "GSuite"]),
];

const BY_KEY = new Map(SKILLS.map((s) => [s.key, s]));

/** Every spelling → skill key (folded). Longest spellings are matched first in text. */
const SPELLINGS: { folded: string; key: string; re: RegExp }[] = SKILLS.flatMap((s) =>
  [s.name, ...(s.aliases ?? [])].map((spelling) => ({ spelling, key: s.key })),
)
  .map(({ spelling, key }) => ({ folded: foldText(spelling), key, re: termRegex(spelling)! }))
  .filter((x) => x.folded && x.re)
  .sort((a, b) => b.folded.length - a.folded.length);

const EXACT = new Map([
  ...SKILLS.flatMap((s) => (s.nameOnly ?? []).map((n) => [foldText(n), s.key] as const)),
  ...SPELLINGS.map((s) => [s.folded, s.key] as const),
]);

export function skillByKey(key: string): SkillDef | undefined {
  return BY_KEY.get(key);
}

/** Canonical key for a skill name (exact name or alias), else null. */
export function canonicalSkillKey(name: string): string | null {
  return EXACT.get(foldText(name)) ?? null;
}

/**
 * Normalised comparison key for any skill name: its canonical key when known,
 * otherwise "name:<folded>" (so unknown skills still compare by exact name only).
 */
export function skillCompareKey(name: string): string {
  return canonicalSkillKey(name) ?? `name:${foldText(name)}`;
}

/** Explicit relationship only (both directions); never inferred. */
export function areRelatedSkills(a: string, b: string): boolean {
  if (a === b) return false;
  return Boolean(BY_KEY.get(a)?.related?.includes(b) || BY_KEY.get(b)?.related?.includes(a));
}

/** Known skills mentioned in a piece of text (whole words; overlapping shorter spellings dropped). */
export function findSkills(text: string): { key: string; matched: string }[] {
  let folded = ` ${foldText(text)} `;
  const found: { key: string; matched: string }[] = [];
  for (const s of SPELLINGS) {
    const m = s.re.exec(folded);
    if (!m) continue;
    if (!found.some((f) => f.key === s.key)) found.push({ key: s.key, matched: s.folded });
    // Blank out the matched span so "Google Analytics 4" does not also yield "Google Analytics".
    folded = folded.replace(s.re, (hit) => hit.replace(/[^\s]/g, " "));
  }
  return found;
}
