import type { Question } from "../data/questions.ts";

export const SITE_URL =
  "https://eagleanurag.github.io/queryvanta";

export const SITE_NAME = "QueryVanta";

export const SITE_TAGLINE =
  "Free SQL & PySpark Practice for Data Engineering";

export const SITE_DESCRIPTION =
  "QueryVanta is a free browser-based Data Engineering practice platform. Practice SQL and PySpark with real in-browser execution, follow learning paths, and prepare with timed mock interviews.";

export const SITE_OG_IMAGE = `${SITE_URL}/og-image.svg`;

export type SeoMeta = {
  title: string;
  description: string;
  canonicalPath: string;
  robots: string;
  ogType?: string;
};

export function canonicalUrl(path: string): string {
  const clean = path.startsWith("/")
    ? path
    : `/${path}`;

  return `${SITE_URL}${clean}`;
}

export function pageSeo(
  title: string,
  description: string,
  canonicalPath: string,
  robots: string = "index,follow",
): SeoMeta {
  return {
    title,
    description,
    canonicalPath,
    robots,
    ogType: "website",
  };
}

function publicPage(
  title: string,
  description: string,
  canonicalPath: string,
): SeoMeta {
  return {
    title,
    description,
    canonicalPath,
    robots: "index,follow",
    ogType: "website",
  };
}

function privatePage(
  title: string,
  description: string,
  canonicalPath: string,
): SeoMeta {
  return {
    title,
    description,
    canonicalPath,
    robots: "noindex,follow",
    ogType: "website",
  };
}

export const HOME_SEO: SeoMeta = publicPage(
  "QueryVanta — Free SQL & PySpark Practice for Data Engineering",
  "Practice SQL and PySpark online for free with real browser-based execution. Data Engineering questions, learning paths, mock interviews and practice analytics.",
  "/",
);

export const LEARN_SEO: SeoMeta = publicPage(
  "Learning Paths — SQL & PySpark | QueryVanta",
  "Follow structured SQL and PySpark learning paths built from real practice questions, with progress tracking and weak-area practice.",
  "/learn",
);

export const INTERVIEW_SEO: SeoMeta = publicPage(
  "Mock Interviews — SQL & Data Engineer Practice | QueryVanta",
  "Practice timed and untimed mock interviews for SQL, PySpark and Data Engineer roles with real query execution and factual session summaries.",
  "/interview",
);

export function learnPathSeo(
  pathId: string,
  title: string,
  description: string,
): SeoMeta {
  return publicPage(
    `${title} — Learning Path | QueryVanta`,
    `${description} Track your progress through real practice questions.`,
    `/learn/${pathId}`,
  );
}

export function learnTopicSeo(
  topicId: string,
  topicName: string,
  total: number,
): SeoMeta {
  return publicPage(
    `${topicName} Practice Questions | QueryVanta`,
    `Practice ${total} ${topicName} question${total === 1 ? "" : "s"} online with real browser execution, hints and solutions.`,
    `/learn/topic/${topicId}`,
  );
}

export function questionSeo(
  question: Question,
): SeoMeta {
  const typeLabel =
    question.questionType === "PySpark"
      ? "PySpark"
      : "SQL";

  return publicPage(
    `${typeLabel} Practice: ${question.title} | QueryVanta`,
    `Practice this ${question.difficulty.toLowerCase()} ${typeLabel} ${question.category.toLowerCase()} problem online. Run your code in the browser and validate the result with QueryVanta.`,
    `/question/${question.id}`,
  );
}

export const PROGRESS_SEO: SeoMeta = privatePage(
  "Progress | QueryVanta",
  "Your personal QueryVanta practice progress and analytics.",
  "/progress",
);

export const PRACTICE_SEO: SeoMeta = privatePage(
  "Practice Session | QueryVanta",
  "Your active QueryVanta practice session.",
  "/practice",
);

export const HISTORY_DETAIL_SEO: SeoMeta = privatePage(
  "Session Review | QueryVanta",
  "Review your completed QueryVanta practice session.",
  "/practice/history",
);

export const ADMIN_SEO: SeoMeta = privatePage(
  "Admin | QueryVanta",
  "QueryVanta local question management.",
  "/admin",
);

export const ADMIN_QUESTIONS_SEO: SeoMeta =
  privatePage(
    "Question Management | QueryVanta",
    "Create and manage local QueryVanta practice questions.",
    "/admin/questions",
  );

export const ADMIN_PREVIEW_SEO: SeoMeta = privatePage(
  "Question Preview | QueryVanta",
  "Preview a QueryVanta question before saving.",
  "/admin/preview",
);

export const PYSPARK_TEST_SEO: SeoMeta = privatePage(
  "PySpark Diagnostics | QueryVanta",
  "QueryVanta PySpark engine diagnostics.",
  "/pyspark-test",
);

export const NOT_FOUND_SEO: SeoMeta = privatePage(
  "Page not found | QueryVanta",
  "This QueryVanta page does not exist.",
  "/404",
);

export type BreadcrumbItem = {
  name: string;
  path: string;
};

export function websiteJsonLd(): Record<
  string,
  unknown
> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    description: SITE_DESCRIPTION,
  };
}

export function webAppJsonLd(): Record<
  string,
  unknown
> {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Any (web browser)",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    description: SITE_DESCRIPTION,
  };
}

export function breadcrumbJsonLd(
  items: BreadcrumbItem[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: canonicalUrl(item.path),
    })),
  };
}

export function itemListJsonLd(
  name: string,
  description: string,
  urlPath: string,
  items: { name: string; path: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    description,
    url: canonicalUrl(urlPath),
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: canonicalUrl(item.path),
    })),
  };
}
