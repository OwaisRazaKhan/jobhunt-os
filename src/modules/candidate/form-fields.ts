import {
  AVAILABILITY_OPTIONS,
  COMPANY_SIZES,
  COMPANY_TYPES,
  EMPLOYMENT_TYPES,
  LANGUAGE_LEVELS,
  PORTFOLIO_TYPES,
  PROJECT_TYPES,
  RELOCATION_OPTIONS,
  SALARY_PERIODS,
  SENIORITY_LEVELS,
  SKILL_CATEGORIES,
  SPONSORSHIP_NEEDS,
  toOptions,
  WORK_AUTHORIZATION_STATUSES,
  WORK_MODES,
} from "./options";
import type { SectionKind } from "./schemas";

/**
 * Declarative form definitions (client-safe). The same definitions drive form
 * rendering and are matched by the Zod schemas on the server.
 */
export type FieldType =
  | "text"
  | "textarea"
  | "url"
  | "email"
  | "tel"
  | "number"
  | "select"
  | "checkbox"
  | "list"
  | "partialDate"
  | "date"
  | "country"
  | "multiselect"
  | "experienceRef"
  | "projectRef";

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
  /** Span both columns in the two-column form grid. */
  wide?: boolean;
  min?: number;
  max?: number;
  step?: number;
}

export const SECTION_FIELDS: Record<SectionKind, FieldDef[]> = {
  education: [
    {
      name: "institution",
      label: "Institution",
      type: "text",
      required: true,
      wide: true,
      placeholder: "University or school",
    },
    { name: "degree", label: "Degree", type: "text", placeholder: "e.g. BBA, BSc, Diploma" },
    { name: "fieldOfStudy", label: "Field of study", type: "text", placeholder: "e.g. Marketing" },
    { name: "startDate", label: "Start", type: "partialDate" },
    { name: "endDate", label: "End", type: "partialDate", help: "Leave empty if current" },
    { name: "isCurrent", label: "I currently study here", type: "checkbox" },
    { name: "location", label: "Location", type: "text" },
    { name: "description", label: "Description", type: "textarea", wide: true },
  ],
  experience: [
    { name: "title", label: "Title", type: "text", required: true, placeholder: "e.g. Founder" },
    { name: "organization", label: "Organization", type: "text", required: true },
    {
      name: "employmentType",
      label: "Employment type",
      type: "select",
      options: toOptions(EMPLOYMENT_TYPES),
    },
    { name: "location", label: "Location", type: "text" },
    { name: "startDate", label: "Start", type: "partialDate" },
    { name: "endDate", label: "End", type: "partialDate", help: "Leave empty if current" },
    { name: "isCurrent", label: "I currently work here", type: "checkbox", wide: true },
    { name: "description", label: "Description", type: "textarea", wide: true },
    {
      name: "responsibilities",
      label: "Responsibilities",
      type: "list",
      wide: true,
      help: "One per line",
    },
    { name: "skillsUsed", label: "Skills used", type: "list", wide: true, help: "One per line" },
  ],
  achievement: [
    {
      name: "statement",
      label: "Achievement",
      type: "textarea",
      required: true,
      wide: true,
      help: "Describe what you actually did or achieved.",
    },
    {
      name: "metric",
      label: "Result / metric (optional)",
      type: "text",
      wide: true,
      help: "Only if you have a real figure. Leave empty otherwise — no numbers are ever generated.",
    },
    { name: "experienceId", label: "Related experience", type: "experienceRef" },
    { name: "projectId", label: "Related project", type: "projectRef" },
  ],
  project: [
    { name: "name", label: "Project name", type: "text", required: true },
    { name: "role", label: "Your role", type: "text" },
    { name: "projectType", label: "Type", type: "select", options: toOptions(PROJECT_TYPES) },
    { name: "teamSize", label: "Team size", type: "number", min: 1, max: 10000 },
    { name: "description", label: "Description", type: "textarea", wide: true },
    { name: "technologies", label: "Technologies", type: "list", help: "One per line" },
    { name: "skills", label: "Skills", type: "list", help: "One per line" },
    {
      name: "responsibilities",
      label: "Responsibilities",
      type: "list",
      wide: true,
      help: "One per line",
    },
    {
      name: "outcomes",
      label: "Outcomes",
      type: "list",
      wide: true,
      help: "One per line. Only real outcomes.",
    },
    { name: "liveUrl", label: "Live URL", type: "url" },
    { name: "repositoryUrl", label: "Repository URL", type: "url" },
    { name: "portfolioUrl", label: "Portfolio / case study URL", type: "url" },
    { name: "imageUrls", label: "Image links", type: "list", help: "One URL per line" },
    { name: "startDate", label: "Start", type: "partialDate" },
    { name: "endDate", label: "End", type: "partialDate" },
    { name: "isCurrent", label: "Ongoing", type: "checkbox", wide: true },
  ],
  skill: [
    { name: "name", label: "Skill", type: "text", required: true },
    { name: "category", label: "Category", type: "select", options: toOptions(SKILL_CATEGORIES) },
    {
      name: "proficiency",
      label: "Proficiency (1–5)",
      type: "select",
      options: ["1", "2", "3", "4", "5"].map((v) => ({
        value: v,
        label: `${v} — ${["Beginner", "Basic", "Intermediate", "Advanced", "Expert"][Number(v) - 1]}`,
      })),
      help: "Your own assessment",
    },
    { name: "yearsUsed", label: "Years used", type: "number", min: 0, max: 60, step: 0.5 },
  ],
  certification: [
    { name: "name", label: "Certification", type: "text", required: true, wide: true },
    { name: "issuer", label: "Issuer", type: "text" },
    { name: "credentialId", label: "Credential ID", type: "text" },
    { name: "issueDate", label: "Issued", type: "partialDate" },
    { name: "expiryDate", label: "Expires", type: "partialDate" },
    { name: "credentialUrl", label: "Credential URL", type: "url", wide: true },
  ],
  portfolio: [
    { name: "title", label: "Title", type: "text", required: true },
    { name: "type", label: "Type", type: "select", options: toOptions(PORTFOLIO_TYPES) },
    { name: "url", label: "URL", type: "url", wide: true },
    { name: "description", label: "Description", type: "textarea", wide: true },
    { name: "skills", label: "Skills shown", type: "list", help: "One per line" },
    { name: "projectId", label: "Associated project", type: "projectRef" },
  ],
  language: [
    { name: "language", label: "Language", type: "text", required: true },
    {
      name: "proficiency",
      label: "Overall level",
      type: "select",
      options: toOptions(LANGUAGE_LEVELS),
      help: "CEFR level as you assess it",
    },
    { name: "reading", label: "Reading", type: "select", options: toOptions(LANGUAGE_LEVELS) },
    { name: "writing", label: "Writing", type: "select", options: toOptions(LANGUAGE_LEVELS) },
    { name: "speaking", label: "Speaking", type: "select", options: toOptions(LANGUAGE_LEVELS) },
  ],
  authorization: [
    { name: "countryCode", label: "Country", type: "country", required: true },
    {
      name: "status",
      label: "Your situation",
      type: "select",
      required: true,
      options: toOptions(WORK_AUTHORIZATION_STATUSES),
    },
    {
      name: "permitType",
      label: "Permit type (optional)",
      type: "text",
      placeholder: "e.g. EU Blue Card",
    },
    { name: "validUntil", label: "Valid until", type: "date" },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
};

export interface SectionMeta {
  title: string;
  singular: string;
  anchor: string;
  empty: string;
  description?: string;
}

export const SECTION_META: Record<SectionKind, SectionMeta> = {
  education: {
    title: "Education",
    singular: "education",
    anchor: "education",
    empty: "No education added yet.",
  },
  experience: {
    title: "Experience",
    singular: "experience",
    anchor: "experience",
    empty: "No experience added yet.",
  },
  achievement: {
    title: "Achievements",
    singular: "achievement",
    anchor: "achievements",
    empty: "No achievements added. Only add things you actually did — metrics are optional.",
  },
  project: {
    title: "Projects",
    singular: "project",
    anchor: "projects",
    empty: "No projects added yet. Projects are key evidence for tailored applications later.",
  },
  skill: { title: "Skills", singular: "skill", anchor: "skills", empty: "No skills added yet." },
  certification: {
    title: "Certifications",
    singular: "certification",
    anchor: "certifications",
    empty: "No certifications added.",
  },
  portfolio: {
    title: "Portfolio",
    singular: "portfolio item",
    anchor: "portfolio",
    empty: "No portfolio items yet.",
  },
  language: {
    title: "Languages",
    singular: "language",
    anchor: "languages",
    empty: "No languages added yet.",
  },
  authorization: {
    title: "Work authorization",
    singular: "authorization",
    anchor: "authorization",
    empty: "No work authorization recorded.",
    description:
      "Your stated situation per country. JOBHUNT OS does not make immigration judgements.",
  },
};

export const PROFILE_BASIC_FIELDS: FieldDef[] = [
  { name: "fullName", label: "Full name", type: "text" },
  {
    name: "headline",
    label: "Professional headline",
    type: "text",
    placeholder: "e.g. Marketing specialist & web developer",
  },
  { name: "currentCity", label: "City", type: "text" },
  { name: "currentCountryCode", label: "Country", type: "country" },
  { name: "professionalEmail", label: "Professional email", type: "email" },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "linkedinUrl", label: "LinkedIn URL", type: "url" },
  { name: "githubUrl", label: "GitHub URL", type: "url" },
  { name: "websiteUrl", label: "Personal website", type: "url" },
  { name: "portfolioUrl", label: "Portfolio URL", type: "url" },
  {
    name: "yearsOfExperience",
    label: "Years of experience",
    type: "number",
    min: 0,
    max: 60,
    step: 0.5,
    help: "Your own statement",
  },
  { name: "summary", label: "Professional summary", type: "textarea", wide: true },
];

export const PROFILE_GOAL_FIELDS: FieldDef[] = [
  {
    name: "careerGoal",
    label: "Career goal",
    type: "textarea",
    wide: true,
    help: "What are you aiming for in the next 1–3 years?",
  },
  {
    name: "availability",
    label: "Availability",
    type: "select",
    options: toOptions(AVAILABILITY_OPTIONS),
  },
  { name: "availableFrom", label: "Available from", type: "date" },
  { name: "noticePeriodWeeks", label: "Notice period (weeks)", type: "number", min: 0, max: 52 },
];

export const PREFERENCE_FIELDS: FieldDef[] = [
  {
    name: "workModes",
    label: "Work mode",
    type: "multiselect",
    options: toOptions(WORK_MODES),
    wide: true,
  },
  {
    name: "employmentTypes",
    label: "Employment type",
    type: "multiselect",
    options: toOptions(EMPLOYMENT_TYPES),
    wide: true,
  },
  {
    name: "seniorityLevels",
    label: "Level",
    type: "multiselect",
    options: toOptions(SENIORITY_LEVELS),
    wide: true,
    help: "Includes internship, graduate and entry-level roles",
  },
  {
    name: "companySizes",
    label: "Company size",
    type: "multiselect",
    options: toOptions(COMPANY_SIZES),
    wide: true,
  },
  {
    name: "companyTypes",
    label: "Company type",
    type: "multiselect",
    options: toOptions(COMPANY_TYPES),
    wide: true,
  },
  {
    name: "relocation",
    label: "Willing to relocate",
    type: "select",
    options: toOptions(RELOCATION_OPTIONS),
  },
  {
    name: "needsSponsorship",
    label: "Need visa sponsorship",
    type: "select",
    options: toOptions(SPONSORSHIP_NEEDS),
  },
  { name: "salaryMin", label: "Salary min", type: "number", min: 0 },
  { name: "salaryMax", label: "Salary max", type: "number", min: 0 },
  {
    name: "salaryCurrency",
    label: "Currency",
    type: "text",
    placeholder: "EUR",
    help: "ISO code, e.g. EUR, USD, AED",
  },
  { name: "salaryPeriod", label: "Period", type: "select", options: toOptions(SALARY_PERIODS) },
];

export const ROLE_FIELDS: FieldDef[] = [
  {
    name: "targetRoles",
    label: "Target roles",
    type: "list",
    wide: true,
    help: "One per line, e.g. Digital Marketing Specialist",
  },
  {
    name: "targetIndustries",
    label: "Target industries",
    type: "list",
    wide: true,
    help: "One per line",
  },
];
