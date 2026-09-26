// QueryVanta SEO asset generator (build-time).
//
// Generates from the canonical sources — no second catalog:
//   - src/data/questions.ts      (built-in public questions)
//   - src/lib/learning.ts        (learning paths, topic slugs)
//   - src/lib/landingPages.ts    (landing page definitions)
//
// Outputs (into public/, copied to dist/ by Vite):
//   - public/sitemap.xml
//   - public/<landing-slug>/index.html (static snapshots for
//     crawlers without JS; the React app serves the same URLs
//     for in-app navigation with identical H1/copy essence)
//
// Deterministic output: no timestamps. Run via the `prebuild`
// npm script with Node type-stripping (sources use erasable
// syntax only, enforced by tsconfig `erasableSyntaxOnly`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { questions } from "../src/data/questions.ts";
import {
  LANDING_PAGES,
  getLandingPage,
} from "../src/lib/landingPages.ts";
import {
  LEARNING_PATHS,
  slugifyTopic,
} from "../src/lib/learning.ts";

const SITE_URL = "https://eagleanurag.github.io/queryvanta";

const __dirname = path.dirname(
  fileURLToPath(import.meta.url),
);
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function matchesLanding(question, page) {
  const { matcher } = page;

  if (
    matcher.questionTypes !== undefined &&
    matcher.questionTypes.length > 0 &&
    !matcher.questionTypes.includes(question.questionType)
  ) {
    return false;
  }

  if (
    matcher.categories !== undefined &&
    matcher.categories.length > 0 &&
    !matcher.categories.includes(question.category)
  ) {
    return false;
  }

  if (
    matcher.difficulties !== undefined &&
    matcher.difficulties.length > 0 &&
    !matcher.difficulties.includes(question.difficulty)
  ) {
    return false;
  }

  return true;
}

function poolFor(page) {
  return questions.filter((question) =>
    matchesLanding(question, page),
  );
}

function sampleFor(pool) {
  const picked = [];
  const seen = new Set();

  for (const difficulty of ["Easy", "Medium", "Hard"]) {
    for (const question of pool) {
      if (picked.length >= 6) {
        break;
      }

      if (
        question.difficulty !== difficulty ||
        seen.has(question.id)
      ) {
        continue;
      }

      seen.add(question.id);
      picked.push(question);
    }
  }

  return picked;
}

function topicsFor(pool) {
  const names = new Set();

  for (const question of pool) {
    if (question.category.trim() !== "") {
      names.add(question.category.trim());
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

function buildSitemap() {
  const urls = [];

  const add = (path, priority) => {
    urls.push({ loc: `${SITE_URL}${path}`, priority });
  };

  add("/", "1.0");

  for (const page of LANDING_PAGES) {
    add(`/${page.slug}`, "0.9");
  }

  add("/learn", "0.9");
  add("/interview", "0.9");

  for (const path of LEARNING_PATHS) {
    add(`/learn/${path.id}`, "0.8");
  }

  for (const topic of topicsFor(questions)) {
    add(`/learn/topic/${slugifyTopic(topic)}`, "0.7");
  }

  for (const question of questions) {
    add(`/question/${question.id}`, "0.6");
  }

  const seen = new Set();
  const unique = urls.filter((entry) => {
    if (seen.has(entry.loc)) {
      return false;
    }

    seen.add(entry.loc);

    return true;
  });

  const body = unique
    .map(
      (entry) =>
        `  <url>\n    <loc>${entry.loc}</loc>\n    <priority>${entry.priority}</priority>\n  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function landingHtml(page) {
  const pool = poolFor(page);
  const samples = sampleFor(pool);
  const topics = topicsFor(pool);
  const canonical = `${SITE_URL}/${page.slug}`;

  const sampleItems = samples
    .map(
      (question) =>
        `      <li><a href="${SITE_URL}/question/${question.id}">${escapeHtml(question.title)}</a> — ${escapeHtml(question.questionType)}, ${escapeHtml(question.category)}, ${escapeHtml(question.difficulty)}</li>`,
    )
    .join("\n");

  const topicItems = topics
    .map((topic) => `      <li>${escapeHtml(topic)}</li>`)
    .join("\n");

  const sectionHtml = page.sections
    .map((section) => {
      const paras = section.body
        .map((para) => `    <p>${escapeHtml(para)}</p>`)
        .join("\n");
      const bullets = section.bullets
        ? `    <ul>\n${section.bullets.map((b) => `      <li>${escapeHtml(b)}</li>`).join("\n")}\n    </ul>`
        : "";

      return `  <h2>${escapeHtml(section.heading)}</h2>\n${paras}\n${bullets}`;
    })
    .join("\n");

  const learnLinks = page.learnPaths
    .map(
      (item) =>
        `      <li><a href="${SITE_URL}/learn/${item.id}">${escapeHtml(item.label)}</a></li>`,
    )
    .join("\n");

  const siblingLinks = page.siblings
    .map(
      (item) =>
        `      <li><a href="${SITE_URL}/${item.slug}">${escapeHtml(item.label)}</a></li>`,
    )
    .join("\n");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: page.h1,
    description: page.description,
    url: canonical,
    numberOfItems: samples.length,
    itemListElement: samples.map((question, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: question.title,
      url: `${SITE_URL}/question/${question.id}`,
    })),
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description)}" />
  <meta name="robots" content="index,follow" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="QueryVanta" />
  <meta property="og:title" content="${escapeHtml(page.title)}" />
  <meta property="og:description" content="${escapeHtml(page.description)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${SITE_URL}/og-image.svg" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeHtml(page.title)}" />
  <meta name="twitter:description" content="${escapeHtml(page.description)}" />
  <meta name="twitter:image" content="${SITE_URL}/og-image.svg" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <style>
    body { font-family: Inter, Arial, sans-serif; color: #202124; background: #f6f7f9; margin: 0; }
    main { max-width: 800px; margin: 0 auto; padding: 32px 16px; }
    a { color: #111827; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-top: 16px; }
  </style>
</head>
<body>
  <main>
    <nav aria-label="Breadcrumb"><a href="${SITE_URL}/">Home</a> / ${escapeHtml(page.navLabel)}</nav>
    <h1>${escapeHtml(page.h1)}</h1>
    <p><strong>${escapeHtml(page.standfirst)}</strong></p>
${page.intro.map((para) => `    <p>${escapeHtml(para)}</p>`).join("\n")}
    <div class="card">
      <p><strong>${pool.length} practice questions available right now</strong> — free, in your browser.</p>
      <p><a href="${SITE_URL}/">Start practicing on QueryVanta</a> · <a href="${SITE_URL}/interview">Open mock interviews</a></p>
    </div>
${sectionHtml}
    <div class="card">
      <h2>Topics covered</h2>
      <ul>
${topicItems}
      </ul>
    </div>
    <div class="card">
      <h2>Sample questions</h2>
      <ul>
${sampleItems}
      </ul>
    </div>
    <div class="card">
      <h2>Learning paths</h2>
      <ul>
${learnLinks}
      </ul>
      <h2>Related practice areas</h2>
      <ul>
${siblingLinks}
      </ul>
    </div>
  </main>
</body>
</html>
`;
}

function main() {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(
      "SEO generator: canonical question catalog is empty.",
    );
  }

  if (
    !Array.isArray(LANDING_PAGES) ||
    LANDING_PAGES.length === 0
  ) {
    throw new Error(
      "SEO generator: no landing pages defined.",
    );
  }

  for (const page of LANDING_PAGES) {
    if (getLandingPage(page.slug) !== page) {
      throw new Error(
        `SEO generator: landing slug mismatch for ${page.slug}.`,
      );
    }

    if (poolFor(page).length === 0) {
      throw new Error(
        `SEO generator: landing page ${page.slug} matches zero questions.`,
      );
    }
  }

  fs.writeFileSync(
    path.join(PUBLIC_DIR, "sitemap.xml"),
    buildSitemap(),
  );

  for (const page of LANDING_PAGES) {
    const dir = path.join(PUBLIC_DIR, page.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      landingHtml(page),
    );
  }

  console.log(
    `SEO assets generated: sitemap.xml + ${LANDING_PAGES.length} landing pages.`,
  );
}

main();
