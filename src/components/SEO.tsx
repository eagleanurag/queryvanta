import { useEffect } from "react";

import {
  canonicalUrl,
  SITE_NAME,
  SITE_OG_IMAGE,
} from "../lib/seo";
import type { SeoMeta } from "../lib/seo";

type SEOProps = {
  meta: SeoMeta;
  /** Optional extra JSON-LD objects (page-specific). */
  jsonLd?: Record<string, unknown>[];
};

function upsertMeta(
  selector: string,
  create: () => HTMLMetaElement,
): HTMLMetaElement {
  const existing = document.head.querySelector(
    selector,
  ) as HTMLMetaElement | null;

  if (existing) {
    return existing;
  }

  const element = create();
  document.head.appendChild(element);

  return element;
}

function setMetaName(
  name: string,
  content: string,
): void {
  const element = upsertMeta(
    `meta[name="${name}"]`,
    () => {
      const created =
        document.createElement("meta");
      created.setAttribute("name", name);

      return created;
    },
  );

  element.setAttribute("content", content);
}

function setMetaProperty(
  property: string,
  content: string,
): void {
  const element = upsertMeta(
    `meta[property="${property}"]`,
    () => {
      const created =
        document.createElement("meta");
      created.setAttribute(
        "property",
        property,
      );

      return created;
    },
  );

  element.setAttribute("content", content);
}

function setCanonical(path: string): void {
  let element = document.head.querySelector(
    'link[rel="canonical"]',
  ) as HTMLLinkElement | null;

  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }

  element.setAttribute(
    "href",
    canonicalUrl(path),
  );
}

/**
 * Route-level SEO head manager. Every public page
 * renders this with its own metadata; values are
 * overwritten (never duplicated) on navigation.
 */
function SEO({ meta, jsonLd = [] }: SEOProps) {
  useEffect(() => {
    document.title = meta.title;

    setMetaName("description", meta.description);
    setMetaName("robots", meta.robots);

    setCanonical(meta.canonicalPath);

    const url = canonicalUrl(meta.canonicalPath);

    setMetaProperty("og:type", meta.ogType ?? "website");
    setMetaProperty("og:site_name", SITE_NAME);
    setMetaProperty("og:title", meta.title);
    setMetaProperty(
      "og:description",
      meta.description,
    );
    setMetaProperty("og:url", url);
    setMetaProperty("og:image", SITE_OG_IMAGE);

    setMetaName("twitter:card", "summary");
    setMetaName("twitter:title", meta.title);
    setMetaName(
      "twitter:description",
      meta.description,
    );
    setMetaName("twitter:image", SITE_OG_IMAGE);

    const injected: HTMLScriptElement[] = [];

    for (const data of jsonLd) {
      const script =
        document.createElement("script");
      script.type = "application/ld+json";
      script.setAttribute(
        "data-qv-jsonld",
        "true",
      );
      script.textContent = JSON.stringify(data);
      document.head.appendChild(script);
      injected.push(script);
    }

    return () => {
      for (const script of injected) {
        script.remove();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    meta.title,
    meta.description,
    meta.canonicalPath,
    meta.robots,
  ]);

  return null;
}

export default SEO;
